// Browser WebSocket API  (Node.js ws  )
import { ServerMessage, FileChangeMessage, AllMessage } from './types';
import { HashUtils } from './utils/hash-utils';
import { MessageFactory } from './message/message-factory';

/**
 * SyncClient  
 */
export interface SyncClientConfig {
  /**  URL */
  serverUrl: string;
  /**   */
  serverPort: number;
  /**   ID */
  vaultId: string;
  /**   ID */
  deviceId: string;
  /**   */
  deviceName: string;
}


/**
 * WebSocket   
 * 
 *  WebSocket      .
 *      .
 * 
 * @example
 * ```typescript
 * const client = new SyncClient({
 *   serverUrl: 'localhost',
 *   serverPort: 3001,
 *   vaultId: 'my-vault',
 *   deviceId: 'device-123',
 *   deviceName: 'My Device'
 * });
 * 
 * client.on('connected', () => console.log('Connected!'));
 * await client.connect();
 * ```
 */
export class SyncClient {
  /** WebSocket   */
  private ws: globalThis.WebSocket | null = null;
  /**   */
  private config: SyncClientConfig;
  /**   */
  private isConnected: boolean = false;
  /**   */
  private reconnectTimeout: NodeJS.Timeout | null = null;
  /**    */
  private eventHandlers: Map<string, Function[]> = new Map();

  constructor(config: SyncClientConfig) {
    this.config = config;
  }

  /**
   *  
   * 
   * WebSocket     .
   *      .
   * 
   * @returns Promise<boolean>   
   * @throws Error   
   */
  connect(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.disconnect();
      }

      const wsUrl = `ws://${this.config.serverUrl}:${this.config.serverPort}`;
      
      try {
        this.ws = new WebSocket(wsUrl);

        const onOpen = (event: Event) => {
          this.isConnected = true;
          this.registerDevice();
          this.emit('connected');
          resolve(true);
        };

        const onClose = (event: CloseEvent) => {
          this.isConnected = false;
          this.emit('disconnected');
          this.scheduleReconnect();
        };

        const onError = (event: Event) => {
          const error = new Error('WebSocket connection failed');
          this.emit('error', error);
          reject(error);
        };

        const onMessage = (event: MessageEvent) => {
          try {
            const message = JSON.parse(event.data) as ServerMessage;
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse message:', error);
            this.emit('parse-error', error);
          }
        };

        this.ws.onopen = onOpen;
        this.ws.onclose = onClose;
        this.ws.onerror = onError;
        this.ws.onmessage = onMessage;

      } catch (error) {
        reject(error as Error);
      }
    });
  }

  /**
   *   
   * 
   * WebSocket      .
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
  }

  /**
   *     
   * 
   * @param filePath   
   * @param content  
   * @throws Error     
   */
  sendFileChange(filePath: string, content: string): void {
    if (!this.isConnected || !this.ws) {
      throw new Error('Not connected to server');
    }

    const message = MessageFactory.createFileChangeMessage({
      vaultId: this.config.vaultId,
      deviceId: this.config.deviceId,
      filePath,
      content,
      hash: HashUtils.generateFileHash(content)
    });

    this.ws.send(JSON.stringify(message));
  }

  requestSync(): void {
    if (!this.isConnected || !this.ws) {
      throw new Error('Not connected to server');
    }

    const message = MessageFactory.createSyncRequestMessage({
      vaultId: this.config.vaultId,
      deviceId: this.config.deviceId
    });

    this.ws.send(JSON.stringify(message));
  }

  /**
   *   
   * 
   * @param event   ('connected', 'disconnected', 'error', 'file-change', 'sync-response' )
   * @param handler      
   */
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  off(event: string, handler: Function): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  generateFileHash(content: string): string {
    return HashUtils.generateFileHash(content);
  }

  /**
   *   
   * 
   * @returns boolean    
   */
  isConnectedToServer(): boolean {
    return this.isConnected;
  }

  private registerDevice(): void {
    if (!this.ws || !this.isConnected) return;

    const message = MessageFactory.createRegisterDeviceMessage({
      vaultId: this.config.vaultId,
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName
    });

    this.ws.send(JSON.stringify(message));
  }

  private handleMessage(message: ServerMessage): void {
    this.emit('message', message);
    
    switch (message.type) {
      case 'file-change':
        this.emit('file-change', message);
        break;
      case 'sync-response':
        this.emit('sync-response', message);
        break;
      case 'lock-acquired':
        this.emit('lock-acquired', message);
        break;
      case 'lock-denied':
        this.emit('lock-denied', message);
        break;
      case 'error':
        this.emit('server-error', message);
        break;
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(...args);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
          //          
        }
      });
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      if (!this.isConnected) {
        this.connect().catch(error => {
          console.error('Reconnection failed:', error);
          //       
        });
      }
    }, 5000);
  }
}