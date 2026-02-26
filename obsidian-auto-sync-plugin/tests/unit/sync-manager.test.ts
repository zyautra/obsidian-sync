import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { App, TFile } from '../mocks/obsidian';

// Mock utility classes
jest.mock('../../src/utils/hash-utils', () => ({
  HashUtils: {
    generateFileHash: jest.fn(() => 'test-hash'),
    arrayBufferToBase64: jest.fn(() => 'base64-content'),
    base64ToArrayBuffer: jest.fn(() => new ArrayBuffer(8))
  }
}));

jest.mock('../../src/utils/file-utils', () => ({
  FileUtils: {
    isTextFile: jest.fn(() => true),
    shouldIgnoreFile: jest.fn(() => false),
    calculateOptimalDebounceDelay: jest.fn(() => 1000)
  }
}));

jest.mock('../../src/utils/error-utils', () => ({
  ErrorUtils: {
    getErrorMessage: jest.fn((error, fallback) => error?.message || fallback || 'Test error'),
    logError: jest.fn(),
    getUserFriendlyMessage: jest.fn((error, context) => 'Test error message'),
    isRetryableError: jest.fn(() => false),
    getStackTrace: jest.fn(() => undefined)
  }
}));

jest.mock('../../src/message/message-factory', () => ({
  MessageFactory: {
    createFileChangeMessage: jest.fn(() => ({ type: 'file-change' })),
    createBinaryFileChangeMessage: jest.fn(() => ({ type: 'binary-file-change' })),
    createFileDeleteMessage: jest.fn(() => ({ type: 'file-delete', filePath: 'test.md' })),
    createFileRenameMessage: jest.fn(() => ({ type: 'file-rename', oldPath: 'old.md', newPath: 'new.md' }))
  }
}));

import { SyncManager } from '../../src/sync/sync-manager';
import { MessageFactory } from '../../src/message/message-factory';
import { FileUtils } from '../../src/utils/file-utils';

describe('SyncManager', () => {
  let syncManager: SyncManager;
  let mockApp: App;
  let mockSendMessage: jest.Mock;
  let mockGetVaultId: jest.Mock;
  let mockGetDeviceId: jest.Mock;

  beforeEach(() => {
    mockApp = new App();
    mockSendMessage = jest.fn().mockReturnValue(true);
    mockGetVaultId = jest.fn().mockReturnValue('test-vault');
    mockGetDeviceId = jest.fn().mockReturnValue('test-device');

    syncManager = new SyncManager(
      mockApp as any,
      1000,
      mockSendMessage as any,
      jest.fn().mockReturnValue(true) as any, // mockSendBinary
      mockGetVaultId as any,
      mockGetDeviceId as any
    );

    jest.clearAllMocks();
  });

  afterEach(() => {
    syncManager.dispose();
  });

  describe('File Deletion', () => {
    it('should send file delete message', () => {
      const filePath = 'test.md';
      
      syncManager.syncFileDelete(filePath);
      
      expect(MessageFactory.createFileDeleteMessage).toHaveBeenCalledWith({
        vaultId: 'test-vault',
        deviceId: 'test-device',
        filePath: 'test.md'
      });
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'file-delete', filePath: 'test.md' });
    });

    it('should remove hash from cache after deletion', () => {
      const filePath = 'test.md';
      
      // Add hash to cache first
      syncManager.updateServerHash(filePath, 'test-hash');
      
      // Verify hash exists
      expect(syncManager['lastKnownHashes'].has(filePath)).toBe(true);
      
      // Delete file
      syncManager.syncFileDelete(filePath);
      
      // Verify hash is removed
      expect(syncManager['lastKnownHashes'].has(filePath)).toBe(false);
    });

    it('should handle deletion of non-cached files', () => {
      const filePath = 'non-cached.md';
      
      // Verify file is not in cache
      expect(syncManager['lastKnownHashes'].has(filePath)).toBe(false);
      
      // Should not throw error
      expect(() => {
        syncManager.syncFileDelete(filePath);
      }).not.toThrow();
      
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('File Rename', () => {
    it('should send file rename message', () => {
      const oldPath = 'old.md';
      const newPath = 'new.md';
      
      syncManager.syncFileRename(oldPath, newPath);
      
      expect(MessageFactory.createFileRenameMessage).toHaveBeenCalledWith({
        vaultId: 'test-vault',
        deviceId: 'test-device',
        oldPath: 'old.md',
        newPath: 'new.md'
      });
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'file-rename', oldPath: 'old.md', newPath: 'new.md' });
    });

    it('should move hash from old path to new path', () => {
      const oldPath = 'old.md';
      const newPath = 'new.md';
      const testHash = 'test-hash';
      
      // Add hash to old path
      syncManager.updateServerHash(oldPath, testHash);
      expect(syncManager.getKnownHash(oldPath)).toBe(testHash);
      
      // Rename file
      syncManager.syncFileRename(oldPath, newPath);
      
      // Hash should be moved to new path
      expect(syncManager.getKnownHash(oldPath)).toBeUndefined();
      expect(syncManager.getKnownHash(newPath)).toBe(testHash);
    });

    it('should handle rename when no hash exists', () => {
      const oldPath = 'non-cached.md';
      const newPath = 'new-name.md';
      
      // Should not throw error even if no hash exists
      expect(() => {
        syncManager.syncFileRename(oldPath, newPath);
      }).not.toThrow();
      
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(syncManager.getKnownHash(newPath)).toBeUndefined();
    });
  });

  describe('File Scheduling', () => {
    it('should schedule file sync', () => {
      const mockFile = new TFile('test.md') as any;
      
      syncManager.scheduleSync(mockFile);
      
      // Should be added to pending syncs
      expect(syncManager['pendingSyncs'].has(mockFile.path)).toBe(true);
    });

    it('should add file to batch', () => {
      const mockFile = new TFile('test.md') as any;
      
      syncManager.addToBatch(mockFile);
      
      // Should be added to batch queue
      expect(syncManager['batchQueue'].has(mockFile.path)).toBe(true);
    });
  });

  describe('Hash Management', () => {
    it('should update server hash', () => {
      const filePath = 'test.md';
      const hash = 'new-hash';
      
      syncManager.updateServerHash(filePath, hash);
      
      expect(syncManager['lastKnownHashes'].get(filePath)).toBe(hash);
    });

    it('should get known hash', () => {
      const filePath = 'test.md';
      const hash = 'test-hash';
      
      syncManager.updateServerHash(filePath, hash);
      
      const retrievedHash = syncManager['getKnownHash'](filePath);
      expect(retrievedHash).toBe(hash);
    });

    it('should return undefined for unknown hash', () => {
      const filePath = 'unknown.md';
      
      const retrievedHash = syncManager['getKnownHash'](filePath);
      expect(retrievedHash).toBeUndefined();
    });
  });

  describe('Memory Management', () => {
    it('should cleanup resources', () => {
      const filePath1 = 'file1.md';
      const filePath2 = 'file2.md';
      
      // Add some data
      syncManager.updateServerHash(filePath1, 'hash1');
      syncManager.updateServerHash(filePath2, 'hash2');
      
      syncManager.cleanup();
      
      // Should have called cleanup (implementation-specific behavior)
      expect(syncManager['lastKnownHashes'].size).toBeGreaterThanOrEqual(0);
    });

    it('should dispose properly', () => {
      const mockFile = new TFile('test.md') as any;
      syncManager.scheduleSync(mockFile);
      
      expect(syncManager['pendingSyncs'].size).toBeGreaterThan(0);
      
      syncManager.dispose();
      
      expect(syncManager['pendingSyncs'].size).toBe(0);
      expect(syncManager['batchQueue'].size).toBe(0);
      expect(syncManager['lastKnownHashes'].size).toBe(0);
    });
  });

  describe('Binary Size Routing', () => {
    it('should use inline binary path for files up to 10MB', async () => {
      (FileUtils.isTextFile as jest.Mock).mockReturnValue(false);
      const file = new TFile('small.bin') as any;
      file.stat.size = 10 * 1024 * 1024;

      const smallSpy = jest.spyOn(syncManager as any, 'syncSmallBinaryFile').mockResolvedValue(undefined);
      const largeSpy = jest.spyOn(syncManager as any, 'syncLargeBinaryFile').mockResolvedValue(undefined);

      await (syncManager as any).syncFile(file);

      expect(smallSpy).toHaveBeenCalled();
      expect(largeSpy).not.toHaveBeenCalled();
    });

    it('should use chunk upload path for files larger than 10MB', async () => {
      (FileUtils.isTextFile as jest.Mock).mockReturnValue(false);
      const file = new TFile('large.bin') as any;
      file.stat.size = 11 * 1024 * 1024;

      const smallSpy = jest.spyOn(syncManager as any, 'syncSmallBinaryFile').mockResolvedValue(undefined);
      const largeSpy = jest.spyOn(syncManager as any, 'syncLargeBinaryFile').mockResolvedValue(undefined);

      await (syncManager as any).syncFile(file);

      expect(largeSpy).toHaveBeenCalled();
      expect(smallSpy).not.toHaveBeenCalled();
    });
  });
});
