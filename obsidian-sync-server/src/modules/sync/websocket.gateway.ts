import { Injectable } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';
import { ConfigService } from '../config/config.service';
import { ConnectionManagerService } from './connection-manager.service';
import { MessageHandlerService, ClientMessage } from './message-handler.service';
import { BroadcastService } from './broadcast.service';
import { ChunkSessionService } from './chunk-session.service';
import { ErrorHandlerService } from '../../common/errors/error-handler.service';
import { SyncErrors } from '../../common/errors/sync-error.types';
import * as WebSocket from 'ws';

@Injectable()
export class WebSocketGateway {
  private wss: WebSocket.Server;
  /**
   * Serialize DB-heavy sync operations to reduce SQLite write-lock contention.
   * SQLite handles concurrent reads well, but concurrent writes can timeout.
   */
  private writeOpQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
    private readonly connectionManager: ConnectionManagerService,
    private readonly messageHandler: MessageHandlerService,
    private readonly broadcastService: BroadcastService,
    private readonly chunkSessionService: ChunkSessionService,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  /**
   * Start the WebSocket server
   */
  startServer(port?: number): void {
    const wsPort = port || this.configService.wsPort;
    
    this.wss = new WebSocket.Server({ 
      port: wsPort,
      maxPayload: 30 * 1024 * 1024, // 30MB (25MB chunk + metadata overhead)
    });
    
    this.wss.on('connection', (ws: WebSocket, req) => {
      this.handleNewConnection(ws, req);
    });

    this.wss.on('error', (error) => {
      this.logger.error('WebSocket server error', error.stack, 'WebSocketServer');
    });

    this.logger.log(`WebSocket server running on ws://localhost:${wsPort}`, 'WebSocketServer');
  }

  /**
   * Handle new WebSocket connection
   */
  private handleNewConnection(ws: WebSocket, req: any): void {
    const clientIp = req.socket.remoteAddress;
    this.logger.logWebSocketEvent('client_connected', clientIp);
    
    // Set up connection health monitoring
    this.setupConnectionHealth(ws, clientIp);
    
    // Initialize chunk upload state
    (ws as any).chunkState = {
      waitingForBinary: false,
      currentChunkMetadata: null,
    };
    
    // Set up message handling
    ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(ws, data, clientIp);
    });
    
    // Set up disconnection handling
    ws.on('close', (code, reason) => {
      this.handleDisconnection(ws, clientIp, code, reason);
    });
    
    ws.on('error', (error) => {
      this.handleConnectionError(ws, clientIp, error);
    });
  }

  /**
   * Set up ping/pong for connection health monitoring
   */
  private setupConnectionHealth(ws: WebSocket, clientIp: string): void {
    let isAlive = true;
    
    ws.on('pong', () => {
      isAlive = true;
    });
    
    const heartbeat = setInterval(() => {
      if (!isAlive) {
        this.logger.logWebSocketEvent(
          'client_heartbeat_failed', 
          clientIp, 
          undefined, 
          undefined, 
          { action: 'terminating' }
        );
        this.handleDisconnection(ws, clientIp);
        ws.terminate();
        return;
      }
      
      isAlive = false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, this.configService.heartbeatInterval);
    
    // Store cleanup function on the WebSocket object
    (ws as any).cleanup = () => {
      clearInterval(heartbeat);
    };
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(ws: WebSocket, data: WebSocket.Data, clientIp: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Check if this is binary data for chunk upload
      if (Buffer.isBuffer(data) && (ws as any).chunkState?.waitingForBinary) {
        await this.handleBinaryChunkData(ws, data, clientIp);
        return;
      }
      
      // Validate message size for text messages
      const dataLength = this.getDataLength(data);
      if (dataLength > 30 * 1024 * 1024) { // 30MB limit for metadata messages
        const error = SyncErrors.messageTooLarge(dataLength, 30 * 1024 * 1024);
        this.errorHandler.sendErrorToClient(ws, error);
        return;
      }
      
      // Update client activity
      this.connectionManager.updateClientActivity(ws);
      
      // Parse message
      const message = this.parseMessage(data);
      
      // Validate message format
      if (!this.validateMessage(message, ws)) {
        return;
      }
      
      // Check rate limiting (except for priority messages)
      if (!this.checkRateLimit(ws, message)) {
        return;
      }
      
      // Route message to appropriate handler
      await this.routeMessage(ws, message);
      
      // Log performance
      const duration = Date.now() - startTime;
      this.logger.logPerformanceMetric(`message_${message.type}`, duration, { messageType: message.type });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      const syncError = this.errorHandler.handleError(
        error,
        'WebSocketGateway',
        'handle_message',
        { clientIp, messageLength: this.getDataLength(data), duration }
      );
      
      this.errorHandler.sendErrorToClient(ws, syncError);
    }
  }

  /**
   * Route message to appropriate handler
   */
  private async routeMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'register-device':
          await this.handleRegisterDevice(ws, message);
          break;
        case 'file-change':
          await this.enqueueWriteOperation(() => this.handleFileChange(ws, message), message.type);
          break;
        case 'binary-file-change':
          await this.enqueueWriteOperation(() => this.handleBinaryFileChange(ws, message), message.type);
          break;
        case 'file-delete':
          await this.enqueueWriteOperation(() => this.handleFileDelete(ws, message), message.type);
          break;
        case 'file-rename':
          await this.enqueueWriteOperation(() => this.handleFileRename(ws, message), message.type);
          break;
        case 'request-lock':
          await this.handleRequestLock(ws, message);
          break;
        case 'request-sync':
          await this.handleRequestSync(ws, message);
          break;
        case 'resolve-conflict':
          await this.enqueueWriteOperation(() => this.handleResolveConflict(ws, message), message.type);
          break;
        case 'chunk-upload-start':
          await this.handleChunkUploadStart(ws, message);
          break;
        case 'chunk-data':
          await this.handleChunkData(ws, message);
          break;
        case 'chunk-upload-complete':
          await this.enqueueWriteOperation(() => this.handleChunkUploadComplete(ws, message), message.type);
          break;
        case 'heartbeat':
          this.handleHeartbeat(ws, message);
          break;
        default:
          const error = this.errorHandler.createValidationError(
            'type',
            (message as any)?.type || 'undefined',
            'valid message type'
          );
          this.errorHandler.sendErrorToClient(ws, error);
      }
    } catch (error) {
      const syncError = this.errorHandler.handleError(
        error,
        'WebSocketGateway',
        `route_${message.type}`,
        { messageType: message.type }
      );
      this.errorHandler.sendErrorToClient(ws, syncError);
    }
  }

  /**
   * Ensure write-heavy operations are processed one-by-one.
   * This trades peak throughput for stability under bursty client uploads.
   */
  private enqueueWriteOperation(
    task: () => Promise<void>,
    messageType: string
  ): Promise<void> {
    const queuedAt = Date.now();

    const run = this.writeOpQueue.then(async () => {
      const queueDelay = Date.now() - queuedAt;
      if (queueDelay > 1000) {
        this.logger.logPerformanceMetric('write_queue_delay', queueDelay, { messageType });
      }
      await task();
    });

    this.writeOpQueue = run
      .catch(() => {
        // Keep queue alive after failures; actual error is handled by caller path.
      }) as Promise<void>;

    return run;
  }

  /**
   * Handle device registration
   */
  private async handleRegisterDevice(ws: WebSocket, message: any): Promise<void> {
    try {
      const response = await this.messageHandler.handleRegisterDevice(message);
      
      // Register client with connection manager
      this.connectionManager.registerClient(ws, {
        vaultId: message.vaultId,
        deviceId: message.deviceId,
        deviceName: message.deviceName,
      });
      
      this.broadcastService.sendMessage(ws, response);
    } catch (error) {
      this.errorHandler.sendErrorToClient(ws, error);
    }
  }

  /**
   * Handle file change
   */
  private async handleFileChange(ws: WebSocket, message: any): Promise<void> {
    try {
      // Update sync stats
      this.connectionManager.initSyncStats(ws);
      const clientInfo = this.connectionManager.getClientInfo(ws);
      
      const result = await this.messageHandler.handleFileChange(message);
      
      // Update stats
      if (clientInfo?.syncStats) {
        if (result.response?.success) {
          clientInfo.syncStats.clientToServer++;
        } else {
          clientInfo.syncStats.conflicts++;
        }
      }
      
      // Broadcast to other clients if successful
      if (result.broadcastMessage) {
        this.broadcastService.broadcastToVault(
          message.vaultId, 
          message.deviceId, 
          result.broadcastMessage
        );
      }

      if (result.response) {
        this.broadcastService.sendMessage(ws, result.response);
      }
    } catch (error) {
      // Update error stats
      const clientInfo = this.connectionManager.getClientInfo(ws);
      if (clientInfo?.syncStats) {
        clientInfo.syncStats.errors++;
      }
      this.errorHandler.sendErrorToClient(ws, error);
    }
  }

  /**
   * Handle file deletion
   */
  private async handleFileDelete(ws: WebSocket, message: any): Promise<void> {
    try {
      const result = await this.messageHandler.handleFileDelete(message);
      
      if (result.broadcastMessage) {
        this.broadcastService.broadcastToVault(
          message.vaultId, 
          message.deviceId, 
          result.broadcastMessage
        );
      }
      
      if (result.response) {
        this.broadcastService.sendMessage(ws, result.response);
      }
    } catch (error) {
      this.errorHandler.sendErrorToClient(ws, error);
    }
  }

  /**
   * Handle lock requests
   */
  private async handleRequestLock(ws: WebSocket, message: any): Promise<void> {
    try {
      const response = await this.messageHandler.handleRequestLock(message);
      this.broadcastService.sendMessage(ws, response);
    } catch (error) {
      this.errorHandler.sendErrorToClient(ws, error);
    }
  }

  /**
   * Handle sync requests
   */
  private async handleRequestSync(ws: WebSocket, message: any): Promise<void> {
    try {
      // Initialize sync stats
      this.connectionManager.initSyncStats(ws);
      const clientInfo = this.connectionManager.getClientInfo(ws);
      if (clientInfo?.syncStats) {
        clientInfo.syncStats.lastSyncStart = new Date();
      }
      
      const result = await this.messageHandler.handleRequestSync(message);
      
      // Update server-to-client stats
      if (clientInfo?.syncStats && result.response.files) {
        clientInfo.syncStats.serverToClient += result.response.files.length;
      }
      
      this.broadcastService.sendMessage(ws, result.response);
      
      // Send sync complete notification after a delay
      if (result.syncComplete && clientInfo?.syncStats) {
        setTimeout(() => {
          this.broadcastService.sendSyncComplete(
            ws, 
            message.vaultId, 
            message.deviceId, 
            clientInfo.syncStats
          );
        }, 2000);
      }
    } catch (error) {
      this.errorHandler.sendErrorToClient(ws, error);
    }
  }

  /**
   * Handle binary file change
   */
  private async handleBinaryFileChange(ws: WebSocket, message: any): Promise<void> {
    try {
      // Update sync stats
      this.connectionManager.initSyncStats(ws);
      const clientInfo = this.connectionManager.getClientInfo(ws);
      
      const result = await this.messageHandler.handleBinaryFileChange(message);
      
      if (result.broadcastMessage) {
        this.broadcastService.broadcastToVault(
          message.vaultId, 
          message.deviceId, 
          result.broadcastMessage
        );
      }
      
      if (result.response) {
        this.broadcastService.sendMessage(ws, result.response);
      }
    } catch (error) {
      this.errorHandler.sendErrorToClient(ws, error);
    }
  }

  /**
   * Handle file rename
   */
  private async handleFileRename(ws: WebSocket, message: any): Promise<void> {
    try {
      const result = await this.messageHandler.handleFileRename(message);
      
      if (result.broadcastMessage) {
        this.broadcastService.broadcastToVault(
          message.vaultId, 
          message.deviceId, 
          result.broadcastMessage
        );
      }
      
      if (result.response) {
        this.broadcastService.sendMessage(ws, result.response);
      }
    } catch (error) {
      this.errorHandler.sendErrorToClient(ws, error);
    }
  }

  /**
   * Handle resolve conflict
   */
  private async handleResolveConflict(ws: WebSocket, message: any): Promise<void> {
    try {
      const result = await this.messageHandler.handleResolveConflict(message);
      
      if (result.broadcastMessage) {
        this.broadcastService.broadcastToVault(
          message.vaultId, 
          message.deviceId, 
          result.broadcastMessage
        );
      }
      
      if (result.response) {
        this.broadcastService.sendMessage(ws, result.response);
      }
    } catch (error) {
      this.errorHandler.sendErrorToClient(ws, error);
    }
  }

  /**
   * Handle heartbeat messages
   */
  private handleHeartbeat(ws: WebSocket, message: any): void {
    this.connectionManager.updateClientActivity(ws);
    const response = this.messageHandler.handleHeartbeat(message);
    this.broadcastService.sendMessage(ws, response);
  }

  /**
   * Handle client disconnection
   */
  private async handleDisconnection(
    ws: WebSocket, 
    clientIp: string, 
    code?: number, 
    reason?: Buffer
  ): Promise<void> {
    this.logger.logWebSocketEvent(
      'client_disconnected', 
      clientIp, 
      undefined, 
      undefined, 
      { code, reason: reason?.toString() }
    );
    
    // Clean up heartbeat
    if ((ws as any).cleanup) {
      (ws as any).cleanup();
    }
    
    // Handle client disconnection
    const clientInfo = this.connectionManager.removeClient(ws);
    if (clientInfo) {
      try {
        // Notify broadcast service to inform other clients
        this.broadcastService.notifyDeviceStatusChange(
          clientInfo.vaultId,
          clientInfo.deviceId,
          'offline',
          clientInfo.deviceName
        );
      } catch (error) {
        this.logger.error('Error during client disconnection cleanup', error.stack, 'WebSocketGateway', { 
          deviceId: clientInfo.deviceId 
        });
      }
    }
  }

  /**
   * Handle chunk upload start
   */
  private async handleChunkUploadStart(ws: WebSocket, message: any): Promise<void> {
    try {
      const fileHash = message.fileHash || message.hash;
      const fileSize = message.fileSize || message.totalSize;
      const totalChunks = Number(message.totalChunks);

      if (!fileHash || !fileSize || !message.filePath || !message.vaultId || !message.deviceId || !totalChunks) {
        this.broadcastService.sendMessage(ws, {
          type: 'chunk-upload-response',
          filePath: message.filePath,
          success: false,
          chunkIndex: -1,
          message: 'Invalid chunk-upload-start metadata',
        });
        return;
      }

      const sessionId = this.chunkSessionService.buildSessionId(message.vaultId, message.deviceId, message.filePath);
      this.chunkSessionService.cancelSession(sessionId);
      this.chunkSessionService.createSession(
        sessionId,
        message.vaultId,
        message.filePath,
        fileHash,
        Number(fileSize),
        totalChunks,
        message.deviceId
      );

      this.broadcastService.sendMessage(ws, {
        type: 'chunk-upload-response',
        filePath: message.filePath,
        success: true,
        chunkIndex: -1,
        message: `Session ${sessionId} ready for chunks`,
      });
    } catch (error) {
      this.errorHandler.sendErrorToClient(ws, error);
    }
  }

  /**
   * Handle chunk data metadata
   */
  private async handleChunkData(ws: WebSocket, message: any): Promise<void> {
    try {
      const sessionId = this.chunkSessionService.buildSessionId(message.vaultId, message.deviceId, message.filePath);
      const session = this.chunkSessionService.getSession(sessionId);
      if (!session) {
        this.broadcastService.sendMessage(ws, {
          type: 'chunk-upload-response',
          filePath: message.filePath,
          success: false,
          chunkIndex: message.chunkIndex,
          message: 'Chunk session not found',
        });
        return;
      }

      // Set up state to expect binary data next
      (ws as any).chunkState = {
        waitingForBinary: true,
        currentChunkMetadata: message,
      };
      
      this.broadcastService.sendMessage(ws, {
        type: 'chunk-upload-response',
        filePath: message.filePath,
        success: true,
        chunkIndex: message.chunkIndex,
        message: 'Ready for binary data',
      });
    } catch (error) {
      this.errorHandler.sendErrorToClient(ws, error);
    }
  }

  /**
   * Handle binary chunk data
   */
  private async handleBinaryChunkData(ws: WebSocket, data: Buffer, clientIp: string): Promise<void> {
    try {
      const chunkState = (ws as any).chunkState;
      if (!chunkState || !chunkState.currentChunkMetadata) {
        this.logger.error('Received binary data without chunk metadata', null, 'WebSocketGateway', { clientIp });
        return;
      }

      const metadata = chunkState.currentChunkMetadata;
      
      // Verify chunk size matches metadata
      if (data.length !== metadata.chunkSize) {
        this.logger.error('Binary chunk size mismatch', null, 'WebSocketGateway', {
          expected: metadata.chunkSize,
          actual: data.length,
          chunkIndex: metadata.chunkIndex,
        });

        // Send error response
        const errorResponse = {
          type: 'chunk-upload-response',
          filePath: metadata.filePath,
          success: false,
          chunkIndex: metadata.chunkIndex,
          message: `Chunk size mismatch: expected ${metadata.chunkSize}, got ${data.length}`,
        };
        this.broadcastService.sendMessage(ws, errorResponse);
        
        // Reset state
        (ws as any).chunkState = {
          waitingForBinary: false,
          currentChunkMetadata: null,
        };
        return;
      }

      const sessionId = this.chunkSessionService.buildSessionId(
        metadata.vaultId,
        metadata.deviceId,
        metadata.filePath
      );

      const storeResult = this.chunkSessionService.storeChunk(
        sessionId,
        metadata.chunkIndex,
        data,
        metadata.chunkHash
      );

      if (!storeResult.success) {
        this.broadcastService.sendMessage(ws, {
          type: 'chunk-upload-response',
          filePath: metadata.filePath,
          success: false,
          chunkIndex: metadata.chunkIndex,
          message: storeResult.message || 'Failed to store chunk',
        });
      } else {
        this.broadcastService.sendMessage(ws, {
          type: 'chunk-upload-response',
          filePath: metadata.filePath,
          success: true,
          chunkIndex: metadata.chunkIndex,
          message: 'Chunk received successfully',
        });
      }

      // Reset state for next chunk
      (ws as any).chunkState = {
        waitingForBinary: false,
        currentChunkMetadata: null,
      };

    } catch (error) {
      this.logger.error('Failed to process binary chunk data', error.stack, 'WebSocketGateway', {
        clientIp,
        dataLength: data.length,
      });

      // Reset state on error
      (ws as any).chunkState = {
        waitingForBinary: false,
        currentChunkMetadata: null,
      };
    }
  }

  /**
   * Handle chunk upload complete
   */
  private async handleChunkUploadComplete(ws: WebSocket, message: any): Promise<void> {
    try {
      const sessionId = this.chunkSessionService.buildSessionId(
        message.vaultId,
        message.deviceId,
        message.filePath
      );

      const completion = await this.chunkSessionService.completeUpload(sessionId);
      if (!completion.success) {
        this.broadcastService.sendMessage(ws, {
          type: 'chunk-upload-response',
          filePath: message.filePath,
          success: false,
          chunkIndex: -1,
          missingChunks: completion.missingChunks,
          message: completion.message || 'Chunk upload completion failed',
        });
        return;
      }

      const fileHash = message.fileHash || message.hash || completion.fileHash;
      const fileSize = message.fileSize || message.totalSize || completion.fileSize;

      await this.messageHandler.recordChunkUploadResult({
        vaultId: message.vaultId,
        deviceId: message.deviceId,
        filePath: message.filePath,
        fileHash,
        fileSize,
        timestamp: message.timestamp || Date.now(),
      });

      this.broadcastService.sendMessage(ws, {
        type: 'chunk-upload-response',
        filePath: message.filePath,
        success: true,
        chunkIndex: -1,
        message: 'File upload completed successfully',
      });
    } catch (error) {
      this.errorHandler.sendErrorToClient(ws, error);
    }
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(ws: WebSocket, clientIp: string, error: Error): void {
    this.logger.error(`WebSocket error from ${clientIp}`, error.stack, 'WebSocketGateway', { clientIp });
    
    // Clean up heartbeat
    if ((ws as any).cleanup) {
      (ws as any).cleanup();
    }
    
    this.handleDisconnection(ws, clientIp);
  }

  /**
   * Utility methods
   */
  private getDataLength(data: WebSocket.Data): number {
    if (Buffer.isBuffer(data)) return data.length;
    if (typeof data === 'string') return data.length;
    if (data instanceof ArrayBuffer) return data.byteLength;
    return 0;
  }

  private parseMessage(data: WebSocket.Data): ClientMessage {
    return JSON.parse(data.toString()) as ClientMessage;
  }

  private validateMessage(message: any, ws: WebSocket): boolean {
    if (!message.type) {
      const error = this.errorHandler.createValidationError('type', message.type, 'string');
      this.errorHandler.sendErrorToClient(ws, error);
      return false;
    }
    return true;
  }

  private checkRateLimit(ws: WebSocket, message: ClientMessage): boolean {
    // Priority messages bypass rate limiting
    if (message.type === 'request-sync' || message.type === 'heartbeat') {
      return true;
    }
    
    if (!this.connectionManager.checkRateLimit(ws, message.type)) {
      const clientInfo = this.connectionManager.getClientInfo(ws);
      const error = SyncErrors.rateLimitExceeded(
        clientInfo?.deviceId || 'unknown',
        this.configService.rateLimitMaxMessages,
        this.configService.rateLimitWindow
      );
      this.errorHandler.sendErrorToClient(ws, error);
      return false;
    }
    
    return true;
  }

  /**
   * Public API methods
   */
  getConnectedClients() {
    return this.connectionManager.getAllClients();
  }
  
  getConnectionStats() {
    return this.connectionManager.getConnectionStats();
  }
  
  getBroadcastStats() {
    return this.broadcastService.getBroadcastStats();
  }

  closeServer(): void {
    if (this.wss) {
      this.connectionManager.shutdown();
      this.wss.close();
    }
  }
}
