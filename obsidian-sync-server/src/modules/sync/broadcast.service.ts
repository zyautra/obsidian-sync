import { Injectable } from '@nestjs/common';
import { ConnectionManagerService } from './connection-manager.service';
import { LoggerService } from '../logger/logger.service';
import * as WebSocket from 'ws';

@Injectable()
export class BroadcastService {
  constructor(
    private readonly connectionManager: ConnectionManagerService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Broadcast message to all clients in a vault except the sender
   */
  broadcastToVault(vaultId: string, excludeDeviceId: string, message: any): void {
    const clients = this.connectionManager.getClientsByVault(vaultId);
    let sentCount = 0;
    
    for (const { ws, info } of clients) {
      if (info.deviceId !== excludeDeviceId && ws.readyState === WebSocket.OPEN) {
        this.sendMessage(ws, message);
        sentCount++;
      }
    }

    this.logger.logWebSocketEvent(
      'message_broadcast',
      undefined,
      undefined,
      vaultId,
      {
        messageType: message.type,
        excludedDevice: excludeDeviceId,
        recipientCount: sentCount,
        totalClientsInVault: clients.length,
      }
    );
  }

  /**
   * Broadcast message to all clients in a vault
   */
  broadcastToAllInVault(vaultId: string, message: any): void {
    const clients = this.connectionManager.getClientsByVault(vaultId);
    let sentCount = 0;
    
    for (const { ws } of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendMessage(ws, message);
        sentCount++;
      }
    }

    this.logger.logWebSocketEvent(
      'message_broadcast_all',
      undefined,
      undefined,
      vaultId,
      {
        messageType: message.type,
        recipientCount: sentCount,
        totalClientsInVault: clients.length,
      }
    );
  }

  /**
   * Send message to specific client by device ID
   */
  sendToDevice(deviceId: string, message: any): boolean {
    const client = this.connectionManager.getClientByDeviceId(deviceId);
    
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn(
        `Cannot send message to device ${deviceId} - not connected`,
        'BroadcastService',
        { messageType: message.type }
      );
      return false;
    }

    this.sendMessage(client.ws, message);
    return true;
  }

  /**
   * Send message to specific WebSocket connection
   */
  sendMessage(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        this.logger.error(
          'Failed to send WebSocket message',
          error.stack,
          'BroadcastService',
          { messageType: message.type }
        );
      }
    }
  }

  /**
   * Notify all clients in vault about device status change
   */
  notifyDeviceStatusChange(vaultId: string, deviceId: string, status: 'online' | 'offline', deviceName?: string): void {
    const message = {
      type: `device-${status}`,
      deviceId,
      deviceName,
      timestamp: Date.now(),
    };

    this.broadcastToVault(vaultId, deviceId, message);
  }

  /**
   * Send sync statistics to a specific client
   */
  sendSyncComplete(ws: WebSocket, vaultId: string, deviceId: string, stats: any): void {
    const message = {
      type: 'initial-sync-complete',
      vaultId,
      deviceId,
      summary: stats,
    };

    this.sendMessage(ws, message);

    this.logger.log('Initial sync completed', 'BroadcastService', {
      vaultId,
      deviceId,
      stats,
    });
  }

  /**
   * Broadcast system-wide announcement
   */
  broadcastSystemMessage(message: any): void {
    const allClients = this.connectionManager.getAllClients();
    let sentCount = 0;

    for (const client of allClients) {
      const clientConnection = this.connectionManager.getClientByDeviceId(client.deviceId);
      if (clientConnection && clientConnection.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(clientConnection.ws, message);
        sentCount++;
      }
    }

    this.logger.logWebSocketEvent(
      'system_broadcast',
      undefined,
      undefined,
      undefined,
      {
        messageType: message.type,
        recipientCount: sentCount,
        totalConnections: allClients.length,
      }
    );
  }

  /**
   * Get broadcast statistics
   */
  getBroadcastStats() {
    const allClients = this.connectionManager.getAllClients();
    const vaultGroups = new Map<string, number>();

    for (const client of allClients) {
      vaultGroups.set(client.vaultId, (vaultGroups.get(client.vaultId) || 0) + 1);
    }

    return {
      totalConnections: allClients.length,
      vaultGroups: Object.fromEntries(vaultGroups),
      largestVault: Math.max(...vaultGroups.values(), 0),
      averageClientsPerVault: vaultGroups.size > 0 ? allClients.length / vaultGroups.size : 0,
    };
  }
}