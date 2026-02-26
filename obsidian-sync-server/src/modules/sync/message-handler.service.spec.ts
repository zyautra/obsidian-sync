import { Test, TestingModule } from '@nestjs/testing';
import { MessageHandlerService, FileChangeMessage } from './message-handler.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from './sync.service';
import { StorageService } from '../storage/storage.service';
import { LoggerService } from '../logger/logger.service';
import { ConnectionManagerService } from './connection-manager.service';
import { ErrorHandlerService } from '../../common/errors/error-handler.service';
import { SyncErrors } from '../../common/errors/sync-error.types';
import { createHash } from 'crypto';

// Mock crypto module
jest.mock('crypto', () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3'),
  }),
}));

describe('MessageHandlerService', () => {
  let service: MessageHandlerService;
  let mockPrisma: any;
  let mockSyncService: jest.Mocked<SyncService>;
  let mockStorageService: jest.Mocked<StorageService>;
  let mockLogger: jest.Mocked<LoggerService>;
  let mockConnectionManager: jest.Mocked<ConnectionManagerService>;
  let mockErrorHandler: jest.Mocked<ErrorHandlerService>;

  beforeEach(async () => {
    mockPrisma = {
      vault: {
        upsert: jest.fn(),
      },
      device: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
      file: {
        findMany: jest.fn(),
      },
      syncOperation: {
        create: jest.fn(),
      },
    };

    mockSyncService = {
      processFileChange: jest.fn(),
      requestFileLock: jest.fn(),
    } as any;

    mockStorageService = {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      calculateHash: jest.fn(),
      calculateSize: jest.fn(),
    } as any;

    mockLogger = {
      logWebSocketEvent: jest.fn(),
      logFileOperation: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    mockConnectionManager = {
      getClientsByVault: jest.fn(),
    } as any;

    mockErrorHandler = {
      handleError: jest.fn(),
    } as any;

    // Create service instance directly
    service = new MessageHandlerService(
      mockPrisma,
      mockSyncService,
      mockStorageService,
      mockLogger,
      mockConnectionManager,
      mockErrorHandler
    );
  });

  describe('handleRegisterDevice', () => {
    it('should register device and create vault if needed', async () => {
      const message = {
        type: 'register-device' as const,
        vaultId: 'vault-1',
        deviceId: 'device-1',
        deviceName: 'Test Device',
      };

      mockPrisma.vault.upsert.mockResolvedValue({
        id: 'vault-1',
        name: 'Vault-vault-1',
      });

      mockPrisma.device.upsert.mockResolvedValue({
        id: 'device-db-1',
        deviceId: 'device-1',
        deviceName: 'Test Device',
      });

      const result = await service.handleRegisterDevice(message);

      expect(result).toEqual({
        type: 'register-device-response',
        vaultId: 'vault-1',
        deviceId: 'device-1',
        success: true,
        message: 'Device registered successfully',
      });

      expect(mockLogger.logWebSocketEvent).toHaveBeenCalledWith(
        'device_registered',
        undefined,
        'device-1',
        'vault-1',
        { deviceName: 'Test Device' }
      );
    });

    it('should handle errors during registration', async () => {
      const message = {
        type: 'register-device' as const,
        vaultId: 'vault-1',
        deviceId: 'device-1',
        deviceName: 'Test Device',
      };

      const error = new Error('Database error');
      mockPrisma.vault.upsert.mockRejectedValue(error);
      mockErrorHandler.handleError.mockReturnValue(SyncErrors.databaseError('register', error));

      await expect(service.handleRegisterDevice(message)).rejects.toThrow();

      expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
        error,
        'MessageHandler',
        'register_device',
        {
          deviceId: 'device-1',
          deviceName: 'Test Device',
          vaultId: 'vault-1',
        }
      );
    });
  });

  describe('handleFileChange', () => {
    const mockMessage: FileChangeMessage = {
      type: 'file-change',
      vaultId: 'vault-1',
      filePath: 'test.md',
      content: 'test content',
      hash: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
      timestamp: Date.now(),
      deviceId: 'device-1',
    };

    it('should process file change successfully', async () => {
      mockSyncService.processFileChange.mockResolvedValue({
        success: true,
        version: 2,
        hash: 'new-hash',
      });

      mockPrisma.device.findUnique.mockResolvedValue({
        id: 'device-db-1',
      });

      mockPrisma.syncOperation.create.mockResolvedValue({
        id: 'sync-op-1',
      });

      const result = await service.handleFileChange(mockMessage);

      expect(mockSyncService.processFileChange).toHaveBeenCalledWith({
        vaultId: 'vault-1',
        deviceId: 'device-1',
        filePath: 'test.md',
        content: 'test content',
        operationType: 'UPDATE',
        previousHash: undefined,
        clientTimestamp: mockMessage.timestamp,
      });

      expect(result.broadcastMessage).toEqual({
        type: 'file-change',
        vaultId: 'vault-1',
        filePath: 'test.md',
        content: 'test content',
        hash: mockMessage.hash,
        timestamp: mockMessage.timestamp,
        deviceId: 'device-1',
      });

      expect(mockLogger.logFileOperation).toHaveBeenCalledWith(
        'UPDATE',
        'test.md',
        'device-1',
        'vault-1',
        true
      );
    });

    it('should throw error when device not found', async () => {
      // Mock syncService.processFileChange to succeed
      mockSyncService.processFileChange.mockResolvedValue({
        success: true,
        version: 1,
        hash: 'hash',
      });

      // Mock device not found for sync operation
      mockPrisma.device.findUnique.mockResolvedValue(null);
      
      // Mock error handler to throw
      const deviceNotFoundError = new Error('Device not found');
      mockErrorHandler.handleError.mockImplementation(() => {
        throw deviceNotFoundError;
      });

      await expect(service.handleFileChange(mockMessage)).rejects.toThrow('Device not found');
    });
  });

  describe('handleRequestSync', () => {
    it('should return file list for sync request', async () => {
      const message = {
        type: 'request-sync' as const,
        vaultId: 'vault-1',
        deviceId: 'device-1',
        lastSyncTime: undefined,
      };

      const mockFiles = [
        {
          path: 'file1.md',
          hash: 'hash1',
          mtime: new Date('2023-01-01'),
          version: 1,
          vaultId: 'vault-1',
        },
        {
          path: 'file2.md',
          hash: 'hash2',
          mtime: new Date('2023-01-02'),
          version: 1,
          vaultId: 'vault-1',
        },
      ];

      mockPrisma.file.findMany.mockResolvedValue(mockFiles);
      mockStorageService.readFile
        .mockResolvedValueOnce('content1')
        .mockResolvedValueOnce('content2');

      const result = await service.handleRequestSync(message);

      expect(result.response).toEqual({
        type: 'sync-response',
        vaultId: 'vault-1',
        deviceId: 'server',
        files: [
          {
            path: 'file1.md',
            content: 'content1',
            hash: 'hash1',
            mtime: new Date('2023-01-01').getTime(),
            version: 1,
            size: undefined,
            isBinary: false,
          },
          {
            path: 'file2.md',
            content: 'content2',
            hash: 'hash2',
            mtime: new Date('2023-01-02').getTime(),
            version: 1,
            size: undefined,
            isBinary: false,
          },
        ],
      });

      expect(result.syncComplete).toEqual({
        type: 'initial-sync-complete',
        vaultId: 'vault-1',
        deviceId: 'device-1',
        summary: {
          serverToClient: 2,
          clientToServer: 0,
          conflicts: 0,
          errors: 0,
        },
      });

      expect(mockLogger.logWebSocketEvent).toHaveBeenCalledWith(
        'sync_response_sent',
        undefined,
        'device-1',
        'vault-1',
        { fileCount: 2 }
      );
    });

    it('should handle file read errors gracefully', async () => {
      const message = {
        type: 'request-sync' as const,
        vaultId: 'vault-1',
        deviceId: 'device-1',
      };

      const mockFiles = [
        {
          path: 'missing-file.md',
          hash: 'hash1',
          mtime: new Date(),
          version: 1,
          vaultId: 'vault-1',
        },
      ];

      mockPrisma.file.findMany.mockResolvedValue(mockFiles);
      mockStorageService.readFile.mockRejectedValue(new Error('File not found'));

      const result = await service.handleRequestSync(message);

      expect(result.response.files).toHaveLength(1);
      expect(result.response.files[0].content).toBe('');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to read file content: missing-file.md',
        expect.any(String),
        'MessageHandler'
      );
    });
  });

  describe('handleRequestLock', () => {
    it('should request file lock successfully', async () => {
      const message = {
        type: 'request-lock' as const,
        vaultId: 'vault-1',
        filePath: 'test.md',
        deviceId: 'device-1',
      };

      const mockLockResult = {
        success: true,
        lock: {
          id: 'lock-1',
          vaultId: 'vault-1',
          fileId: 'file-1',
          deviceId: 'device-1',
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 30000),
          isExpired: false,
        },
      };

      mockSyncService.requestFileLock.mockResolvedValue(mockLockResult);

      const result = await service.handleRequestLock(message);

      expect(result).toEqual({
        type: 'lock-acquired',
        vaultId: 'vault-1',
        filePath: 'test.md',
        deviceId: 'device-1',
        expiresAt: expect.any(String),
      });
    });

    it('should handle lock denied', async () => {
      const message = {
        type: 'request-lock' as const,
        vaultId: 'vault-1',
        filePath: 'test.md',
        deviceId: 'device-1',
      };

      mockSyncService.requestFileLock.mockResolvedValue(null); //   null 

      const result = await service.handleRequestLock(message);

      expect(result).toEqual({
        type: 'lock-denied',
        vaultId: 'vault-1',
        filePath: 'test.md',
        reason: 'File already locked',
      });
    });
  });

  describe('handleHeartbeat', () => {
    it('should return heartbeat response', () => {
      const message = {
        type: 'heartbeat' as const,
        timestamp: Date.now(),
      };

      const result = service.handleHeartbeat(message);

      expect(result).toEqual({
        type: 'heartbeat-response',
        timestamp: expect.any(Number),
      });
    });
  });
});