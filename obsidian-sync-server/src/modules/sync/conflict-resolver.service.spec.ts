import { Test, TestingModule } from '@nestjs/testing';
import { ConflictResolverService, FileConflictData } from './conflict-resolver.service';
import { LoggerService } from '../logger/logger.service';

describe('ConflictResolverService', () => {
  let service: ConflictResolverService;
  let mockLogger: jest.Mocked<LoggerService>;

  beforeEach(async () => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      verbose: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConflictResolverService,
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ConflictResolverService>(ConflictResolverService);
  });

  describe('resolveFileConflict', () => {
    const baseData: FileConflictData = {
      vaultId: 'vault-1',
      filePath: 'test.md',
      clientContent: 'new content',
      clientHash: 'new-hash',
    };

    it('should accept create operation when no existing file', () => {
      const result = service.resolveFileConflict({
        ...baseData,
        existingFile: undefined,
      });

      expect(result.action).toBe('accept');
      expect(result.reason).toBe('Creating new file');
      expect(result.updated).toBe('created');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No existing file, accepting create operation',
        'ConflictResolver',
        expect.objectContaining({
          filePath: 'test.md',
          vaultId: 'vault-1',
        })
      );
    });

    it('should reject when hash mismatch detected', () => {
      const result = service.resolveFileConflict({
        ...baseData,
        previousHash: 'old-hash',
        existingFile: {
          id: 'file-1',
          hash: 'different-hash',
          version: 2,
          mtime: new Date(),
          size: 100,
        },
      });

      expect(result.action).toBe('reject');
      expect(result.conflictType).toBe('hash_mismatch');
      expect(result.currentVersion).toBe(2);
      expect(result.currentHash).toBe('different-hash');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Hash-based conflict detected',
        'ConflictResolver',
        expect.objectContaining({
          filePath: 'test.md',
          expectedHash: 'old-hash',
          actualHash: 'different-hash',
        })
      );
    });

    it('should update mtime only when same content but newer timestamp', () => {
      const clientTime = new Date('2023-12-01T10:00:00Z');
      const serverTime = new Date('2023-12-01T09:00:00Z');

      const result = service.resolveFileConflict({
        ...baseData,
        clientHash: 'same-hash',
        clientTimestamp: clientTime.getTime(),
        existingFile: {
          id: 'file-1',
          hash: 'same-hash',
          version: 1,
          mtime: serverTime,
          size: 100,
        },
      });

      expect(result.action).toBe('update_mtime_only');
      expect(result.reason).toBe('Same content, updating modification time');
      expect(result.updated).toBe('mtime_only');
    });

    it('should reject when client timestamp is older', () => {
      const clientTime = new Date('2023-12-01T09:00:00Z');
      const serverTime = new Date('2023-12-01T10:00:00Z');

      const result = service.resolveFileConflict({
        ...baseData,
        clientHash: 'different-hash',
        clientTimestamp: clientTime.getTime(),
        existingFile: {
          id: 'file-1',
          hash: 'server-hash',
          version: 2,
          mtime: serverTime,
          size: 100,
        },
      });

      expect(result.action).toBe('reject');
      expect(result.conflictType).toBe('older_timestamp');
      expect(result.clientMtime).toBe(clientTime.getTime());
      expect(result.serverMtime).toBe(serverTime.getTime());
    });

    it('should accept update when client timestamp is newer', () => {
      const clientTime = new Date('2023-12-01T10:00:00Z');
      const serverTime = new Date('2023-12-01T09:00:00Z');

      const result = service.resolveFileConflict({
        ...baseData,
        clientHash: 'new-hash',
        clientTimestamp: clientTime.getTime(),
        existingFile: {
          id: 'file-1',
          hash: 'old-hash',
          version: 1,
          mtime: serverTime,
          size: 100,
        },
      });

      expect(result.action).toBe('accept');
      expect(result.reason).toBe('Update accepted - client version is newer or hash validation passed');
      expect(result.updated).toBe('full');
    });
  });

  describe('resolveRenameConflict', () => {
    it('should reject when source file does not exist', () => {
      const result = service.resolveRenameConflict(
        'vault-1',
        'old.md',
        'new.md',
        undefined,
        false
      );

      expect(result.action).toBe('reject');
      expect(result.reason).toBe('Cannot rename non-existent file');
      expect(result.conflictType).toBe('source_not_found');
    });

    it('should reject when target path already exists', () => {
      const result = service.resolveRenameConflict(
        'vault-1',
        'old.md',
        'new.md',
        { id: 'file-1' },
        true
      );

      expect(result.action).toBe('reject');
      expect(result.reason).toBe('Target path already exists');
      expect(result.conflictType).toBe('target_exists');
    });

    it('should accept valid rename operation', () => {
      const result = service.resolveRenameConflict(
        'vault-1',
        'old.md',
        'new.md',
        { id: 'file-1' },
        false
      );

      expect(result.action).toBe('accept');
      expect(result.reason).toBe('Rename operation is valid');
    });
  });

  describe('resolveDeleteConflict', () => {
    it('should accept when file already does not exist', () => {
      const result = service.resolveDeleteConflict(
        'vault-1',
        'test.md',
        undefined,
        false
      );

      expect(result.action).toBe('accept');
      expect(result.reason).toBe('File already does not exist');
      expect(result.updated).toBe('already_deleted');
    });

    it('should reject when file has active locks', () => {
      const result = service.resolveDeleteConflict(
        'vault-1',
        'test.md',
        { id: 'file-1' },
        true
      );

      expect(result.action).toBe('reject');
      expect(result.reason).toBe('Cannot delete file with active locks');
      expect(result.conflictType).toBe('file_locked');
    });

    it('should accept valid delete operation', () => {
      const result = service.resolveDeleteConflict(
        'vault-1',
        'test.md',
        { id: 'file-1' },
        false
      );

      expect(result.action).toBe('accept');
      expect(result.reason).toBe('Delete operation is valid');
    });
  });

  describe('getResolutionStrategy', () => {
    it('should return non-retryable strategy for hash mismatch', () => {
      const strategy = service.getResolutionStrategy('UPDATE', 'hash_mismatch');

      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.clientAction).toBe('fetch_latest_and_merge');
    });

    it('should return retryable strategy for lock conflicts', () => {
      const strategy = service.getResolutionStrategy('DELETE', 'file_locked');

      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.retryDelay).toBe(5000);
      expect(strategy.clientAction).toBe('wait_for_lock_release');
    });

    it('should return default retryable strategy for unknown conflicts', () => {
      const strategy = service.getResolutionStrategy('UPDATE', 'unknown_conflict');

      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.retryDelay).toBe(1000);
    });
  });
});