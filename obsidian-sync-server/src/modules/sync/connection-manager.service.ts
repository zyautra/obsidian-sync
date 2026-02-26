import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { LoggerService } from '../logger/logger.service';
import * as WebSocket from 'ws';

export interface ClientInfo {
  vaultId: string;
  deviceId: string;
  deviceName: string;
  lastSeen: Date;
  connectTime: Date;
  syncStats?: {
    serverToClient: number;
    clientToServer: number;
    conflicts: number;
    errors: number;
    lastSyncStart?: Date;
  };
  rateLimitInfo?: {
    lastMessageTime: number;
    messageCount: number;
    windowStart: number;
  };
}

@Injectable()
export class ConnectionManagerService {
  private clients = new Map<WebSocket, ClientInfo>();
  private clientsByDeviceId = new Map<string, WebSocket>();
  private cleanupInterval: NodeJS.Timeout;
  
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  /**
   * Register a new client connection
   */
  registerClient(ws: WebSocket, clientInfo: Omit<ClientInfo, 'connectTime' | 'lastSeen'>): void {
    const fullClientInfo: ClientInfo = {
      ...clientInfo,
      connectTime: new Date(),
      lastSeen: new Date(),
    };

    // Check for existing connection with same deviceId
    const existingWs = this.clientsByDeviceId.get(clientInfo.deviceId);
    if (existingWs && existingWs !== ws) {
      this.logger.warn(
        `Device ${clientInfo.deviceId} already connected, closing previous connection`,
        'ConnectionManager',
        { deviceId: clientInfo.deviceId, deviceName: clientInfo.deviceName }
      );
      this.removeClient(existingWs);
      if (existingWs.readyState === WebSocket.OPEN) {
        existingWs.close(1000, 'New connection established');
      }
    }

    this.clients.set(ws, fullClientInfo);
    this.clientsByDeviceId.set(clientInfo.deviceId, ws);

    this.logger.logWebSocketEvent(
      'client_registered', 
      undefined, 
      clientInfo.deviceId, 
      clientInfo.vaultId,
      { 
        deviceName: clientInfo.deviceName,
        totalConnections: this.clients.size 
      }
    );
  }

  /**
   * Remove a client connection
   */
  removeClient(ws: WebSocket): ClientInfo | null {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return null;

    this.clients.delete(ws);
    this.clientsByDeviceId.delete(clientInfo.deviceId);

    const connectionDuration = Date.now() - clientInfo.connectTime.getTime();
    this.logger.logWebSocketEvent(
      'client_removed', 
      undefined, 
      clientInfo.deviceId, 
      clientInfo.vaultId,
      { 
        deviceName: clientInfo.deviceName,
        connectionDuration,
        totalConnections: this.clients.size 
      }
    );

    return clientInfo;
  }

  /**
   * Update client last seen timestamp
   */
  updateClientActivity(ws: WebSocket): void {
    const clientInfo = this.clients.get(ws);
    if (clientInfo) {
      clientInfo.lastSeen = new Date();
    }
  }

  /**
   * Get client information
   */
  getClientInfo(ws: WebSocket): ClientInfo | undefined {
    return this.clients.get(ws);
  }

  /**
   * Get all connected clients
   */
  getAllClients(): ClientInfo[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get clients by vault ID
   */
  getClientsByVault(vaultId: string): Array<{ ws: WebSocket; info: ClientInfo }> {
    const result: Array<{ ws: WebSocket; info: ClientInfo }> = [];
    
    for (const [ws, info] of this.clients.entries()) {
      if (info.vaultId === vaultId) {
        result.push({ ws, info });
      }
    }
    
    return result;
  }

  /**
   * Get client by device ID
   */
  getClientByDeviceId(deviceId: string): { ws: WebSocket; info: ClientInfo } | undefined {
    const ws = this.clientsByDeviceId.get(deviceId);
    if (!ws) return undefined;
    
    const info = this.clients.get(ws);
    if (!info) return undefined;
    
    return { ws, info };
  }

  /**
   * Check rate limiting for a client
   */
  checkRateLimit(ws: WebSocket, messageType: string): boolean {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return true; // Allow if no client info yet

    const now = Date.now();
    const windowSize = this.configService.rateLimitWindow;
    const maxMessages = this.configService.rateLimitMaxMessages;

    if (!clientInfo.rateLimitInfo) {
      clientInfo.rateLimitInfo = {
        messageCount: 1,
        windowStart: now,
        lastMessageTime: now,
      };
      return true;
    }

    const { rateLimitInfo } = clientInfo;

    // Reset window if expired
    if (now - rateLimitInfo.windowStart > windowSize) {
      rateLimitInfo.messageCount = 1;
      rateLimitInfo.windowStart = now;
      rateLimitInfo.lastMessageTime = now;
      return true;
    }

    // Check if limit exceeded
    if (rateLimitInfo.messageCount >= maxMessages) {
      this.logger.warn(
        `Rate limit exceeded for client ${clientInfo.deviceId}`,
        'RateLimit',
        {
          messageType,
          messageCount: rateLimitInfo.messageCount,
          deviceId: clientInfo.deviceId,
          maxMessages,
          windowSize,
        }
      );
      return false;
    }

    // Allow message
    rateLimitInfo.messageCount++;
    rateLimitInfo.lastMessageTime = now;
    return true;
  }

  /**
   * Initialize sync stats for a client
   */
  initSyncStats(ws: WebSocket): void {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return;

    if (!clientInfo.syncStats) {
      clientInfo.syncStats = {
        serverToClient: 0,
        clientToServer: 0,
        conflicts: 0,
        errors: 0,
        lastSyncStart: new Date(),
      };
    }
  }

  /**
   * Get connection statistics
   */
  getConnectionStats() {
    const totalConnections = this.clients.size;
    const vaultCounts = new Map<string, number>();
    const deviceCounts = new Map<string, number>();
    
    for (const info of this.clients.values()) {
      vaultCounts.set(info.vaultId, (vaultCounts.get(info.vaultId) || 0) + 1);
      deviceCounts.set(info.deviceId, (deviceCounts.get(info.deviceId) || 0) + 1);
    }

    return {
      totalConnections,
      uniqueVaults: vaultCounts.size,
      uniqueDevices: deviceCounts.size,
      vaultDistribution: Object.fromEntries(vaultCounts),
      memoryUsage: process.memoryUsage(),
    };
  }

  /**
   * Start periodic cleanup of stale connections
   */
  private startPeriodicCleanup(): void {
    const cleanupIntervalMs = this.configService.heartbeatInterval * 2; // 2x heartbeat interval
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, cleanupIntervalMs);

    this.logger.log(
      `Started connection cleanup with ${cleanupIntervalMs}ms interval`,
      'ConnectionManager'
    );
  }

  /**
   * Clean up stale connections
   */
  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleThreshold = this.configService.heartbeatInterval * 3; // 3x heartbeat interval
    const staleConnections: WebSocket[] = [];

    for (const [ws, info] of this.clients.entries()) {
      const timeSinceLastSeen = now - info.lastSeen.getTime();
      
      if (timeSinceLastSeen > staleThreshold || ws.readyState === WebSocket.CLOSED) {
        staleConnections.push(ws);
      }
    }

    if (staleConnections.length > 0) {
      this.logger.warn(
        `Cleaning up ${staleConnections.length} stale connections`,
        'ConnectionManager',
        { staleThreshold, totalConnections: this.clients.size }
      );

      for (const ws of staleConnections) {
        const info = this.removeClient(ws);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1001, 'Connection cleanup - stale connection');
        }
      }
    }
  }

  /**
   * Shutdown the connection manager
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all active connections gracefully
    for (const [ws, info] of this.clients.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1001, 'Server shutdown');
      }
    }

    this.clients.clear();
    this.clientsByDeviceId.clear();

    this.logger.log('Connection manager shut down', 'ConnectionManager');
  }
}