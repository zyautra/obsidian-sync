import { Test, TestingModule } from '@nestjs/testing';
import { BroadcastService } from './broadcast.service';
import { ConnectionManagerService, ClientInfo } from './connection-manager.service';
import { LoggerService } from '../logger/logger.service';
import * as WebSocket from 'ws';

describe('BroadcastService', () => {
  let service: BroadcastService;
  let mockConnectionManager: jest.Mocked<ConnectionManagerService>;
  let mockLogger: jest.Mocked<LoggerService>;
  let mockWs1: any;
  let mockWs2: any;

  beforeEach(async () => {
    // Create mock WebSocket objects with writable readyState
    mockWs1 = {
      send: jest.fn(),
    };
    Object.defineProperty(mockWs1, 'readyState', {
      value: WebSocket.OPEN,
      writable: true,
      configurable: true,
    });

    mockWs2 = {
      send: jest.fn(),
    };
    Object.defineProperty(mockWs2, 'readyState', {
      value: WebSocket.OPEN,
      writable: true,
      configurable: true,
    });

    mockConnectionManager = {
      getClientsByVault: jest.fn(),
      getClientByDeviceId: jest.fn(),
      getAllClients: jest.fn(),
    } as any;

    mockLogger = {
      logWebSocketEvent: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastService,
        { provide: ConnectionManagerService, useValue: mockConnectionManager },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<BroadcastService>(BroadcastService);
  });

  describe('broadcastToVault', () => {
    it('should broadcast message to all clients in vault except sender', () => {
      const clientInfo1: ClientInfo = {
        vaultId: 'vault-1',
        deviceId: 'device-1',
        deviceName: 'Device 1',
        lastSeen: new Date(),
        connectTime: new Date(),
      };

      const clientInfo2: ClientInfo = {
        vaultId: 'vault-1',
        deviceId: 'device-2',
        deviceName: 'Device 2',
        lastSeen: new Date(),
        connectTime: new Date(),
      };

      mockConnectionManager.getClientsByVault.mockReturnValue([
        { ws: mockWs1, info: clientInfo1 },
        { ws: mockWs2, info: clientInfo2 },
      ]);

      const message = { type: 'test-message', content: 'hello' };

      service.broadcastToVault('vault-1', 'device-1', message);

      expect(mockWs1.send).not.toHaveBeenCalled(); // Excluded sender
      expect(mockWs2.send).toHaveBeenCalledWith(JSON.stringify(message));
      expect(mockLogger.logWebSocketEvent).toHaveBeenCalledWith(
        'message_broadcast',
        undefined,
        undefined,
        'vault-1',
        expect.objectContaining({
          messageType: 'test-message',
          excludedDevice: 'device-1',
          recipientCount: 1,
          totalClientsInVault: 2,
        })
      );
    });

    it('should skip clients with closed connections', () => {
      const clientInfo1: ClientInfo = {
        vaultId: 'vault-1',
        deviceId: 'device-1',
        deviceName: 'Device 1',
        lastSeen: new Date(),
        connectTime: new Date(),
      };

      Object.defineProperty(mockWs1, 'readyState', {
        value: WebSocket.CLOSED,
        writable: true,
        configurable: true,
      });

      mockConnectionManager.getClientsByVault.mockReturnValue([
        { ws: mockWs1, info: clientInfo1 },
      ]);

      const message = { type: 'test-message' };

      service.broadcastToVault('vault-1', 'device-2', message);

      expect(mockWs1.send).not.toHaveBeenCalled();
      expect(mockLogger.logWebSocketEvent).toHaveBeenCalledWith(
        'message_broadcast',
        undefined,
        undefined,
        'vault-1',
        expect.objectContaining({
          recipientCount: 0,
        })
      );
    });
  });

  describe('sendToDevice', () => {
    it('should send message to specific device', () => {
      const clientInfo: ClientInfo = {
        vaultId: 'vault-1',
        deviceId: 'device-1',
        deviceName: 'Device 1',
        lastSeen: new Date(),
        connectTime: new Date(),
      };

      mockConnectionManager.getClientByDeviceId.mockReturnValue({
        ws: mockWs1,
        info: clientInfo,
      });

      const message = { type: 'direct-message', content: 'hello device-1' };

      const result = service.sendToDevice('device-1', message);

      expect(result).toBe(true);
      expect(mockWs1.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it('should return false when device not connected', () => {
      mockConnectionManager.getClientByDeviceId.mockReturnValue(undefined);

      const message = { type: 'direct-message' };

      const result = service.sendToDevice('device-1', message);

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Cannot send message to device device-1 - not connected',
        'BroadcastService',
        expect.objectContaining({ messageType: 'direct-message' })
      );
    });

    it('should return false when device connection is closed', () => {
      Object.defineProperty(mockWs1, 'readyState', {
        value: WebSocket.CLOSED,
        writable: true,
        configurable: true,
      });

      mockConnectionManager.getClientByDeviceId.mockReturnValue({
        ws: mockWs1,
        info: {} as ClientInfo,
      });

      const result = service.sendToDevice('device-1', { type: 'test' });

      expect(result).toBe(false);
      expect(mockWs1.send).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('should send message when connection is open', () => {
      const message = { type: 'test', data: 'hello' };

      service.sendMessage(mockWs1, message);

      expect(mockWs1.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it('should not send message when connection is closed', () => {
      Object.defineProperty(mockWs1, 'readyState', {
        value: WebSocket.CLOSED,
        writable: true,
        configurable: true,
      });

      service.sendMessage(mockWs1, { type: 'test' });

      expect(mockWs1.send).not.toHaveBeenCalled();
    });

    it('should handle send errors gracefully', () => {
      mockWs1.send.mockImplementation(() => {
        throw new Error('Send failed');
      });

      service.sendMessage(mockWs1, { type: 'test' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send WebSocket message',
        expect.stringContaining('Send failed'),
        'BroadcastService',
        expect.objectContaining({ messageType: 'test' })
      );
    });
  });

  describe('getBroadcastStats', () => {
    it('should return broadcast statistics', () => {
      const clients: ClientInfo[] = [
        {
          vaultId: 'vault-1',
          deviceId: 'device-1',
          deviceName: 'Device 1',
          lastSeen: new Date(),
          connectTime: new Date(),
        },
        {
          vaultId: 'vault-1',
          deviceId: 'device-2',
          deviceName: 'Device 2',
          lastSeen: new Date(),
          connectTime: new Date(),
        },
        {
          vaultId: 'vault-2',
          deviceId: 'device-3',
          deviceName: 'Device 3',
          lastSeen: new Date(),
          connectTime: new Date(),
        },
      ];

      mockConnectionManager.getAllClients.mockReturnValue(clients);

      const stats = service.getBroadcastStats();

      expect(stats).toEqual({
        totalConnections: 3,
        vaultGroups: {
          'vault-1': 2,
          'vault-2': 1,
        },
        largestVault: 2,
        averageClientsPerVault: 1.5,
      });
    });

    it('should handle empty client list', () => {
      mockConnectionManager.getAllClients.mockReturnValue([]);

      const stats = service.getBroadcastStats();

      expect(stats).toEqual({
        totalConnections: 0,
        vaultGroups: {},
        largestVault: 0,
        averageClientsPerVault: 0,
      });
    });
  });
});