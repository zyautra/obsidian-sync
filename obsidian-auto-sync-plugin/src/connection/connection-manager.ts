import { Notice } from 'obsidian';
import { ErrorUtils } from '../utils/error-utils';
import { MessageFactory } from '../message/message-factory';

/**
 * WebSocket  
 * 
 * WebSocket  , ,   .
 *     .
 */
export class ConnectionManager {
  /** WebSocket   */
  private ws: globalThis.WebSocket | null = null;
  /**   */
  private isConnected: boolean = false;
  /**    */
  private reconnectAttempts: number = 0;
  /**     */
  private readonly maxReconnectAttempts: number = 5;
  /**   */
  private reconnectTimeout: NodeJS.Timeout | null = null;
  /** Heartbeat  */
  private heartbeatInterval: NodeJS.Timeout | null = null;
  /**  Heartbeat  */
  private lastHeartbeat: number = 0;
  /** Heartbeat  */
  private readonly heartbeatIntervalMs: number = 30000; // 30
  /**     */
  private qualityCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    private serverUrl: string,
    private serverPort: number,
    private deviceId: string,
    private onMessage: (message: any) => void,
    private onConnectionChange: (connected: boolean) => void
  ) {}

  /**
   *  
   * 
   * @returns   
   */
  async connect(): Promise<boolean> {
    if (this.ws) {
      this.disconnect();
    }

    const wsUrl = `ws://${this.serverUrl}:${this.serverPort}`;
    
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.resetReconnectionState();
          this.onConnectionChange(true);
          this.startHeartbeat();
          this.startQualityMonitoring();
          new Notice('Connected to sync server');
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            
            // Heartbeat  
            if (message.type === 'heartbeat-response') {
              this.lastHeartbeat = Date.now();
              return;
            }
            
            this.onMessage(message);
          } catch (error) {
            ErrorUtils.logError('WebSocket message parsing', error, { rawMessage: event.data });
          }
        };

        this.ws.onclose = (event) => {
          this.isConnected = false;
          this.onConnectionChange(false);
          this.stopHeartbeat();
          this.stopQualityMonitoring();
          
          //     
          if (event.code !== 1000 && event.code !== 1001) {
            new Notice(`Connection closed (code: ${event.code})`);
            this.scheduleReconnection();
          }
        };

        this.ws.onerror = (event) => {
          ErrorUtils.logError('WebSocket connection error', event);
          const userMessage = ErrorUtils.getUserFriendlyMessage(event, 'WebSocket connection');
          new Notice(`❌ ${userMessage}`);
          reject(new Error('WebSocket connection failed'));
        };

        //   
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('Connection timeout'));
          }
        }, 10000); // 10 

      } catch (error) {
        ErrorUtils.logError('WebSocket creation failed', error, { 
          serverUrl: this.serverUrl, 
          serverPort: this.serverPort 
        });
        reject(error as Error);
      }
    });
  }

  /**
   *   
   */
  disconnect(): void {
    this.stopHeartbeat();
    this.stopQualityMonitoring();
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      //   
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      
      //  
      try {
        this.ws.close(1000, 'Normal closure');
      } catch (error) {
        ErrorUtils.logError('WebSocket close error', error);
      }
      
      this.ws = null;
    }
    
    this.isConnected = false;
    this.onConnectionChange(false);
  }

  /**
   * JSON  
   * 
   * @param message  
   * @returns   
   */
  sendMessage(message: any): boolean {
    if (!this.isConnected || !this.ws) {
      console.warn('Cannot send message: not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      ErrorUtils.logError('Message send failed', error, { messageType: message.type });
      return false;
    }
  }

  /**
   *   
   * 
   * @param data    (ArrayBuffer)
   * @returns   
   */
  sendBinary(data: ArrayBuffer): boolean {
    if (!this.isConnected || !this.ws) {
      console.warn('Cannot send binary data: not connected');
      return false;
    }

    if (!(data instanceof ArrayBuffer)) {
      console.error('Invalid binary data: expected ArrayBuffer');
      return false;
    }

    try {
      this.ws.send(data);
      return true;
    } catch (error) {
      ErrorUtils.logError('Binary send failed', error, { 
        dataSize: data.byteLength,
        dataType: 'ArrayBuffer'
      });
      return false;
    }
  }

  /**
   *   
   * 
   * @returns   
   */
  getConnectionState(): boolean {
    return this.isConnected;
  }

  /**
   *   
   * 
   * @returns    
   */
  getConnectionQuality(): {
    connected: boolean;
    reconnectAttempts: number;
    lastHeartbeat: number;
    timeSinceLastHeartbeat: number;
  } {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      lastHeartbeat: this.lastHeartbeat,
      timeSinceLastHeartbeat: this.lastHeartbeat > 0 ? Date.now() - this.lastHeartbeat : 0
    };
  }

  /**
   *     
   */
  private scheduleReconnection(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      new Notice(
        `Reached maximum reconnect attempts (${this.maxReconnectAttempts}). ` +
        'Please reconnect manually or restart the plugin.'
      );
      return;
    }

    //  : 2^attempt * 1000ms ( 30)
    const delay = Math.min(Math.pow(2, this.reconnectAttempts) * 1000, 30000);
    this.reconnectAttempts++;

    new Notice(
      `Retrying connection in ${delay / 1000}s... ` +
      `(${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimeout = setTimeout(async () => {
      if (!this.isConnected) {
        console.log(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        
        try {
          await this.connect();
        } catch (error) {
          ErrorUtils.logError('Reconnection attempt failed', error, { 
            attempt: this.reconnectAttempts, 
            maxAttempts: this.maxReconnectAttempts 
          });
          //     
          this.scheduleReconnection();
        }
      }
    }, delay);
  }

  /**
   *    (   )
   */
  private resetReconnectionState(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Heartbeat 
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
    
    //   heartbeat  
    this.sendHeartbeat();
  }

  /**
   * Heartbeat 
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Heartbeat  
   */
  private sendHeartbeat(): void {
    if (!this.isConnected || !this.ws) {
      return;
    }

    try {
      const message = MessageFactory.createHeartbeatMessage(this.deviceId);
      this.ws.send(JSON.stringify(message));
      
      //    heartbeat    
      //   
    } catch (error) {
      ErrorUtils.logError('Heartbeat send failed', error);
      // Heartbeat     
      this.handleConnectionError(error as Error);
    }
  }

  /**
   *    
   */
  private startQualityMonitoring(): void {
    this.stopQualityMonitoring();
    
    // 1   
    this.qualityCheckInterval = setInterval(() => {
      this.checkConnectionQuality();
    }, 60000);
  }

  /**
   *    
   */
  private stopQualityMonitoring(): void {
    if (this.qualityCheckInterval) {
      clearInterval(this.qualityCheckInterval);
      this.qualityCheckInterval = null;
    }
  }

  /**
   *   
   */
  private checkConnectionQuality(): void {
    if (!this.isConnected) {
      return;
    }

    const now = Date.now();
    const timeSinceLastHeartbeat = now - this.lastHeartbeat;

    // Heartbeat  2    
    if (timeSinceLastHeartbeat > this.heartbeatIntervalMs * 2) {
      console.warn(
        'Heartbeat response delayed, connection may be unstable. ' +
        `Last heartbeat: ${timeSinceLastHeartbeat}ms ago`
      );
      
      //     heartbeat
      this.sendHeartbeat();
    }

    //       
    if (timeSinceLastHeartbeat > this.heartbeatIntervalMs * 3) {
      ErrorUtils.logError('Connection health check', 'Connection appears to be dead, attempting reconnection');
      this.handleConnectionError(new Error('Connection timeout'));
    }
  }

  /**
   *   
   * 
   * @param error  
   */
  private handleConnectionError(error: Error): void {
    const errorMessage = this.getErrorMessage(error);
    new Notice(`🚫 Connection error: ${errorMessage}`, 5000);
    
    //      
    if (error.message.includes('ECONNREFUSED')) {
      new Notice('💡 Check whether the server is running.', 8000);
    } else if (error.message.includes('ETIMEDOUT')) {
      new Notice('💡 Check your network connection.', 8000);
    }

    //       
    if (this.isConnected) {
      this.isConnected = false;
      this.onConnectionChange(false);
      this.scheduleReconnection();
    }
  }

  /**
   *     
   * 
   * @param error  
   * @returns   
   */
  private getErrorMessage(error: Error): string {
    const message = error.message;
    
    if (message.includes('ECONNREFUSED')) {
      return 'Unable to connect to server';
    } else if (message.includes('ETIMEDOUT')) {
      return 'Connection timed out';
    } else if (message.includes('ENOTFOUND')) {
      return 'Server not found';
    } else {
      return message.length > 50 ? message.substring(0, 50) + '...' : message;
    }
  }
}
