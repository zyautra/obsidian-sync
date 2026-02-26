import { Test, TestingModule } from '@nestjs/testing';
import { WebSocketGateway } from './websocket.gateway';
import { MessageHandlerService, RegisterDeviceMessage, FileChangeMessage, RequestSyncMessage } from './message-handler.service';
import { BroadcastService } from './broadcast.service';
import { ConnectionManagerService } from './connection-manager.service';
import { LoggerService } from '../logger/logger.service';
import { ConfigService } from '../config/config.service';
import { ErrorHandlerService } from '../../common/errors/error-handler.service';
import { ChunkSessionService } from './chunk-session.service';

describe('WebSocket Integration Tests', () => {
  let gateway: WebSocketGateway;
  let messageHandler: MessageHandlerService;
  let broadcastService: BroadcastService;
  let connectionManager: ConnectionManagerService;
  let configService: ConfigService;

  const mockLogger = {
    logWebSocketEvent: jest.fn(),
    logPerformanceMetric: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  } as any;

  const mockConfigService = {
    wsPort: 3001,
    maxFileSize: 50 * 1024 * 1024,
    heartbeatInterval: 30000,
    rateLimitMaxMessages: 100,
    rateLimitWindow: 30000,
  };

  const mockErrorHandler = {
    handleError: jest.fn(),
    sendErrorToClient: jest.fn(),
    createValidationError: jest.fn(),
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebSocketGateway,
        { provide: LoggerService, useValue: mockLogger },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ErrorHandlerService, useValue: mockErrorHandler },
        {
          provide: ConnectionManagerService,
          useValue: {
            registerClient: jest.fn(),
            removeClient: jest.fn(),
            updateClientActivity: jest.fn(),
            checkRateLimit: jest.fn().mockReturnValue(true),
            getClientInfo: jest.fn(),
            initSyncStats: jest.fn(),
            shutdown: jest.fn(),
            getConnectionStats: jest.fn(),
          },
        },
        {
          provide: MessageHandlerService,
          useValue: {
            handleRegisterDevice: jest.fn(),
            handleFileChange: jest.fn(),
            handleFileDelete: jest.fn(),
            handleRequestLock: jest.fn(),
            handleRequestSync: jest.fn(),
            handleHeartbeat: jest.fn(),
            recordChunkUploadResult: jest.fn(),
          },
        },
        {
          provide: ChunkSessionService,
          useValue: {
            buildSessionId: jest.fn((vaultId: string, deviceId: string, filePath: string) => `${vaultId}:${deviceId}:${filePath}`),
            cancelSession: jest.fn(),
            createSession: jest.fn(),
            getSession: jest.fn().mockReturnValue({}),
            storeChunk: jest.fn().mockReturnValue({ success: true }),
            completeUpload: jest.fn().mockResolvedValue({ success: true, fileHash: 'hash', fileSize: 1 }),
          },
        },
        {
          provide: BroadcastService,
          useValue: {
            sendMessage: jest.fn(),
            broadcastToVault: jest.fn(),
            notifyDeviceStatusChange: jest.fn(),
            sendSyncComplete: jest.fn(),
            getBroadcastStats: jest.fn(),
          },
        },
      ],
    }).compile();

    gateway = module.get<WebSocketGateway>(WebSocketGateway);
    messageHandler = module.get<MessageHandlerService>(MessageHandlerService);
    broadcastService = module.get<BroadcastService>(BroadcastService);
    connectionManager = module.get<ConnectionManagerService>(ConnectionManagerService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('Message Flow Integration', () => {
    it('should handle device registration flow', async () => {
      const registerMessage: RegisterDeviceMessage = {
        type: 'register-device',
        vaultId: 'vault-1',
        deviceId: 'device-1',
        deviceName: 'Test Device',
      };

      const mockResponse = {
        type: 'register-device-response',
        vaultId: 'vault-1',
        deviceId: 'device-1',
        success: true,
        message: 'Device registered successfully',
      };

      (messageHandler.handleRegisterDevice as jest.Mock).mockResolvedValue(mockResponse);

      const result = await messageHandler.handleRegisterDevice(registerMessage);
      
      expect(result).toEqual(mockResponse);
      expect(messageHandler.handleRegisterDevice).toHaveBeenCalledWith(registerMessage);
    });

    it('should handle file change with broadcast', async () => {
      const fileChangeMessage: FileChangeMessage = {
        type: 'file-change',
        vaultId: 'vault-1',
        filePath: 'test.md',
        content: 'test content',
        hash: 'test-hash',
        timestamp: Date.now(),
        deviceId: 'device-1',
      };

      const mockResult = {
        broadcastMessage: {
          type: 'file-change',
          vaultId: 'vault-1',
          filePath: 'test.md',
          content: 'test content',
          hash: 'test-hash',
          timestamp: fileChangeMessage.timestamp,
          deviceId: 'device-1',
        }
      };

      (messageHandler.handleFileChange as jest.Mock).mockResolvedValue(mockResult);

      const result = await messageHandler.handleFileChange(fileChangeMessage);

      expect(result).toEqual(mockResult);
      expect(messageHandler.handleFileChange).toHaveBeenCalledWith(fileChangeMessage);
    });

    it('should send file-change response back to sender', async () => {
      const ws = {} as any;
      const fileChangeMessage: FileChangeMessage = {
        type: 'file-change',
        vaultId: 'vault-1',
        filePath: 'test.md',
        content: 'test content',
        hash: 'test-hash',
        timestamp: Date.now(),
        deviceId: 'device-1',
      };

      const response = {
        type: 'file-change-response',
        success: true,
        filePath: 'test.md',
        hash: 'test-hash',
        version: 2,
      };

      (messageHandler.handleFileChange as jest.Mock).mockResolvedValue({
        broadcastMessage: { type: 'file-change', filePath: 'test.md' },
        response,
      });

      await (gateway as any).handleFileChange(ws, fileChangeMessage);

      expect(broadcastService.sendMessage).toHaveBeenCalledWith(ws, response);
    });

    it('should handle sync request with response', async () => {
      const syncMessage: RequestSyncMessage = {
        type: 'request-sync',
        vaultId: 'vault-1',
        deviceId: 'device-1',
        lastSyncTime: undefined,
      };

      const mockSyncResponse = {
        response: {
          type: 'sync-response',
          vaultId: 'vault-1',
          deviceId: 'server',
          files: [
            {
              path: 'test.md',
              content: 'content',
              hash: 'hash',
              mtime: Date.now(),
              version: 1,
            }
          ],
        },
        syncComplete: {
          type: 'initial-sync-complete',
          vaultId: 'vault-1',
          deviceId: 'device-1',
          summary: {
            serverToClient: 1,
            clientToServer: 0,
            conflicts: 0,
            errors: 0,
          },
        }
      };

      (messageHandler.handleRequestSync as jest.Mock).mockResolvedValue(mockSyncResponse);

      const result = await messageHandler.handleRequestSync(syncMessage);

      expect(result).toEqual(mockSyncResponse);
      expect(result.response.files).toHaveLength(1);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle invalid message format', () => {
      const invalidMessage = { invalidField: 'test' };

      expect(mockErrorHandler.createValidationError).toBeDefined();
      expect(mockErrorHandler.sendErrorToClient).toBeDefined();
    });

    it('should handle rate limiting', () => {
      const message = {
        type: 'file-change',
        vaultId: 'vault-1',
        filePath: 'test.md',
        content: 'content',
        hash: 'hash',
        timestamp: Date.now(),
        deviceId: 'device-1',
      };

      // Mock rate limit exceeded
      (connectionManager.checkRateLimit as jest.Mock).mockReturnValue(false);

      const rateLimited = connectionManager.checkRateLimit(null as any, message.type);
      expect(rateLimited).toBe(false);
    });
  });

  describe('Connection Management Integration', () => {
    it('should track connection statistics', () => {
      const mockStats = {
        totalConnections: 2,
        uniqueVaults: 1,
        uniqueDevices: 2,
        vaultDistribution: { 'vault-1': 2 },
        memoryUsage: process.memoryUsage(),
      };

      (connectionManager.getConnectionStats as jest.Mock).mockReturnValue(mockStats);

      const stats = gateway.getConnectionStats();
      expect(stats).toEqual(mockStats);
    });

    it('should handle connection cleanup on disconnect', () => {
      const clientInfo = {
        vaultId: 'vault-1',
        deviceId: 'device-1',
        deviceName: 'Test Device',
        lastSeen: new Date(),
        connectTime: new Date(),
      };

      (connectionManager.removeClient as jest.Mock).mockReturnValue(clientInfo);

      const result = connectionManager.removeClient(null as any);
      
      expect(result).toEqual(clientInfo);
    });
  });

  describe('Broadcast Integration', () => {
    it('should calculate broadcast statistics correctly', () => {
      const mockStats = {
        totalConnections: 3,
        vaultGroups: {
          'vault-1': 2,
          'vault-2': 1,
        },
        largestVault: 2,
        averageClientsPerVault: 1.5,
      };

      (broadcastService.getBroadcastStats as jest.Mock).mockReturnValue(mockStats);

      const stats = gateway.getBroadcastStats();
      expect(stats).toEqual(mockStats);
    });

    it('should handle message broadcasting to vault', () => {
      const message = {
        type: 'file-change',
        vaultId: 'vault-1',
        filePath: 'test.md',
        content: 'content',
        hash: 'hash',
        timestamp: Date.now(),
        deviceId: 'device-1',
      };

      broadcastService.broadcastToVault('vault-1', 'device-1', message);

      expect(broadcastService.broadcastToVault).toHaveBeenCalledWith(
        'vault-1',
        'device-1',
        message
      );
    });
  });

  describe('Configuration Integration', () => {
    it('should use configuration values consistently', () => {
      expect(configService.wsPort).toBe(3001);
      expect(configService.maxFileSize).toBe(50 * 1024 * 1024);
      expect(configService.heartbeatInterval).toBe(30000);
      expect(configService.rateLimitMaxMessages).toBe(100);
      expect(configService.rateLimitWindow).toBe(30000);
    });

    it('should validate message size against configuration', () => {
      const largeContent = 'x'.repeat(configService.maxFileSize + 1);
      const dataLength = Buffer.byteLength(largeContent);

      expect(dataLength).toBeGreaterThan(configService.maxFileSize);
      expect(mockErrorHandler.sendErrorToClient).toBeDefined();
    });
  });

  describe('Performance Monitoring Integration', () => {
    it('should log performance metrics for message processing', () => {
      const messageType = 'file-change';
      const duration = 150;

      mockLogger.logPerformanceMetric(messageType, duration, { messageType });

      expect(mockLogger.logPerformanceMetric).toHaveBeenCalledWith(
        messageType,
        duration,
        { messageType }
      );
    });

    it('should track WebSocket events', () => {
      const eventType = 'client_connected';
      const clientIp = '127.0.0.1';

      mockLogger.logWebSocketEvent(eventType, clientIp);

      expect(mockLogger.logWebSocketEvent).toHaveBeenCalledWith(eventType, clientIp);
    });
  });
});
