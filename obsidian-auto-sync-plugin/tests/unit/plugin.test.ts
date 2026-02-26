import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { App, TFile, Notice } from '../mocks/obsidian';

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
    createFileChangeMessage: jest.fn(() => ({ type: 'file-change', vaultId: 'test', deviceId: 'test' })),
    createFileDeleteMessage: jest.fn(() => ({ type: 'file-delete', vaultId: 'test', deviceId: 'test' })),
    createFileRenameMessage: jest.fn(() => ({ type: 'file-rename', vaultId: 'test', deviceId: 'test' })),
    createRegisterDeviceMessage: jest.fn(() => ({ type: 'register-device', vaultId: 'test', deviceId: 'test' })),
    createSyncRequestMessage: jest.fn(() => ({ type: 'request-sync', vaultId: 'test', deviceId: 'test' }))
  }
}));

jest.mock('../../src/validation/settings-validator', () => ({
  SettingsValidator: {
    validateForConnection: jest.fn(() => ({ canConnect: true })),
    validateVaultId: jest.fn(() => ({ valid: true })),
    validateServerUrl: jest.fn(() => ({ valid: true }))
  }
}));

// Mock managers
const mockSyncManager = {
  scheduleSync: jest.fn(),
  addToBatch: jest.fn(),
  syncFileDelete: jest.fn(),
  syncFileRename: jest.fn(),
  updateServerHash: jest.fn(),
  getKnownHash: jest.fn(() => 'test-hash'),
  cleanup: jest.fn(),
  dispose: jest.fn()
};

jest.mock('../../src/sync/sync-manager', () => ({
  SyncManager: jest.fn(() => mockSyncManager)
}));

const mockConnectionManager = {
  connect: jest.fn(() => Promise.resolve(true)),
  disconnect: jest.fn(),
  sendMessage: jest.fn(() => true),
  getConnectionState: jest.fn(() => true)
};

jest.mock('../../src/connection/connection-manager', () => ({
  ConnectionManager: jest.fn(() => mockConnectionManager)
}));

import AutoSyncPlugin from '../../src/main';

describe('AutoSyncPlugin', () => {
  let plugin: AutoSyncPlugin;
  let mockApp: App;
  let mockManifest: any;

  beforeEach(async () => {
    mockApp = new App();
    mockManifest = { id: 'auto-sync-plugin', name: 'Auto Sync' };
    
    plugin = new AutoSyncPlugin(mockApp as any, mockManifest);
    
    plugin.loadData = jest.fn(() => Promise.resolve({}));
    plugin.saveData = jest.fn(() => Promise.resolve());
    
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (plugin) {
      plugin.onunload();
    }
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should load plugin successfully', async () => {
      await plugin.onload();
      
      expect(plugin.settings).toBeDefined();
      expect(plugin.deviceId).toBeDefined();
    });

    it('should generate device ID on load', async () => {
      await plugin.onload();
      
      expect(plugin.deviceId).toBeTruthy();
      expect(typeof plugin.deviceId).toBe('string');
    });

    it('should set device name if not provided', async () => {
      await plugin.onload();
      
      if (!plugin.settings.deviceName) {
        expect(plugin.settings.deviceName).toContain('Device-');
      }
    });

    it('should create status bar element', async () => {
      await plugin.onload();
      
      expect(plugin.syncStatusBar).toBeDefined();
    });
  });

  describe('Settings Management', () => {
    it('should load default settings', async () => {
      await plugin.loadSettings();
      
      expect(plugin.settings.serverUrl).toBe('10.0.0.1');
      expect(plugin.settings.serverPort).toBe(3001);
      expect(plugin.settings.enableSync).toBe(false);
    });

    it('should save settings', async () => {
      await plugin.loadSettings(); // Load settings first
      plugin.settings.serverUrl = 'test.com';
      await plugin.saveSettings();
      
      expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
    });
  });

  describe('Connection Management', () => {
    beforeEach(async () => {
      await plugin.onload();
    });

    it('should connect to server when enabled', async () => {
      plugin.settings.vaultId = 'test-vault';
      await plugin.connectToServer();
      
      expect(mockConnectionManager.connect).toHaveBeenCalled();
    });

    it('should disconnect from server', () => {
      plugin.disconnectFromServer();
      
      expect(mockConnectionManager.disconnect).toHaveBeenCalled();
    });

    it('should get connection state', () => {
      const state = plugin.getConnectionState();
      
      expect(mockConnectionManager.getConnectionState).toHaveBeenCalled();
      expect(typeof state).toBe('boolean');
    });
  });

  describe('File Event Handling', () => {
    beforeEach(async () => {
      await plugin.onload();
      plugin.settings.enableSync = true;
    });

    it('should handle file modification', async () => {
      const mockFile = new TFile('test.md');
      
      await plugin.onFileModified(mockFile);
      
      expect(mockSyncManager.scheduleSync).toHaveBeenCalledWith(mockFile);
    });

    it('should handle file creation', async () => {
      const mockFile = new TFile('new-file.md');
      
      await plugin.onFileCreated(mockFile);
      
      expect(mockSyncManager.scheduleSync).toHaveBeenCalledWith(mockFile);
    });

    it('should handle file deletion', async () => {
      const mockFile = new TFile('deleted.md');
      
      await plugin.onFileDeleted(mockFile);
      
      expect(mockSyncManager.syncFileDelete).toHaveBeenCalledWith(mockFile.path);
    });

    it('should handle file rename', async () => {
      const mockFile = new TFile('new-name.md');
      const oldPath = 'old-name.md';
      
      await plugin.onFileRenamed(mockFile, oldPath);
      
      expect(mockSyncManager.syncFileRename).toHaveBeenCalledWith(oldPath, mockFile.path);
    });

    it('should not sync when sync is disabled', async () => {
      plugin.settings.enableSync = false;
      const mockFile = new TFile('test.md');
      
      await plugin.onFileModified(mockFile);
      
      expect(mockSyncManager.scheduleSync).not.toHaveBeenCalled();
    });

    it('should not sync when not connected', async () => {
      mockConnectionManager.getConnectionState.mockReturnValue(false);
      const mockFile = new TFile('test.md');
      
      await plugin.onFileModified(mockFile);
      
      expect(mockSyncManager.scheduleSync).not.toHaveBeenCalled();
    });
  });

  describe('Vault ID Management', () => {
    beforeEach(async () => {
      await plugin.onload();
    });

    it('should return vault ID from settings', () => {
      plugin.settings.vaultId = 'my-vault';
      
      const vaultId = plugin.getVaultId();
      
      expect(vaultId).toBe('my-vault');
    });

    it('should extract vault ID from system when not set', () => {
      plugin.settings.vaultId = '';
      
      const vaultId = plugin.getVaultId();
      
      // Should call extractVaultIdFromSystem
      expect(typeof vaultId).toBe('string');
    });
  });

  describe('Sync Operations', () => {
    beforeEach(async () => {
      await plugin.onload();
      plugin.settings.enableSync = true;
      plugin.settings.vaultId = 'test-vault';
      // Mock the connection state to be true for these tests
      mockConnectionManager.getConnectionState.mockReturnValue(true);
    });

    it('should perform initial sync', async () => {
      (plugin as any).isDeviceRegistered = true;
      await plugin.performInitialSync();
      
      expect(mockConnectionManager.sendMessage).toHaveBeenCalled();
    });

    it('should sync all local files', async () => {
      const mockFiles = [new TFile('file1.md'), new TFile('file2.md')];
      
      mockApp.vault.getAllLoadedFiles = jest.fn(() => mockFiles);
      
      await plugin.syncAllLocalFiles();
      
      expect(mockSyncManager.addToBatch).toHaveBeenCalledTimes(2);
    });

    it('should force sync all', async () => {
      await plugin.forceSyncAll();
      
      expect(mockConnectionManager.sendMessage).toHaveBeenCalled();
    });

    it('should not sync when not connected', async () => {
      mockConnectionManager.getConnectionState.mockReturnValue(false);
      
      await plugin.forceSyncAll();
      
      expect(mockConnectionManager.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Status Management', () => {
    beforeEach(async () => {
      await plugin.onload();
    });

    it('should update status bar when connected', () => {
      plugin.settings.enableSync = true;
      mockConnectionManager.getConnectionState.mockReturnValue(true);
      
      plugin.updateStatusBar();
      
      expect(plugin.syncStatusBar.setText).toHaveBeenCalledWith('🟢 Sync');
    });

    it('should update status bar when connecting', () => {
      plugin.settings.enableSync = true;
      mockConnectionManager.getConnectionState.mockReturnValue(false);
      
      plugin.updateStatusBar();
      
      expect(plugin.syncStatusBar.setText).toHaveBeenCalledWith('🟡 Sync');
    });

    it('should update status bar when disabled', () => {
      plugin.settings.enableSync = false;
      
      plugin.updateStatusBar();
      
      expect(plugin.syncStatusBar.setText).toHaveBeenCalledWith('⭕ Sync');
    });
  });

  describe('Toggle Sync', () => {
    beforeEach(async () => {
      await plugin.onload();
      plugin.settings.vaultId = 'test-vault';
    });

    it('should enable sync when disabled', () => {
      plugin.settings.enableSync = false;
      plugin.connectToServer = jest.fn(() => Promise.resolve());
      
      plugin.toggleSync();
      
      expect(plugin.settings.enableSync).toBe(true);
      expect(plugin.connectToServer).toHaveBeenCalled();
    });

    it('should disable sync when enabled', () => {
      plugin.settings.enableSync = true;
      plugin.disconnectFromServer = jest.fn(() => {});
      
      plugin.toggleSync();
      
      expect(plugin.settings.enableSync).toBe(false);
      expect(plugin.disconnectFromServer).toHaveBeenCalled();
    });
  });

  describe('Message Handling', () => {
    beforeEach(async () => {
      await plugin.onload();
    });

    it('should handle remote file change message', async () => {
      const message = {
        type: 'file-change',
        deviceId: 'other-device',
        filePath: 'test.md',
        content: 'new content',
        hash: 'new-hash',
        isBinary: false
      };
      
      await plugin.handleServerMessage(message as any);
      
      expect(mockSyncManager.updateServerHash).toHaveBeenCalledWith('test.md', 'new-hash');
    });

    it('should handle file delete message', async () => {
      const message = {
        type: 'file-delete',
        deviceId: 'other-device',
        filePath: 'deleted.md',
        vaultId: 'test-vault',
        timestamp: Date.now()
      };
      
      // Mock file exists in vault
      const mockFile = new TFile('deleted.md');
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      
      await plugin.handleServerMessage(message as any);
      
      // Should call vault.delete with the file
      expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledWith('deleted.md');
      expect(mockApp.vault.delete).toHaveBeenCalled();
    });

    it('should handle file delete message when file does not exist', async () => {
      const message = {
        type: 'file-delete',
        deviceId: 'other-device',
        filePath: 'non-existent.md',
        vaultId: 'test-vault',
        timestamp: Date.now()
      };
      
      // Mock file does not exist
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      
      await plugin.handleServerMessage(message as any);
      
      // Should check for file but not attempt deletion
      expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledWith('non-existent.md');
      expect(mockApp.vault.delete).not.toHaveBeenCalled();
    });

    it('should ignore file delete messages from same device', async () => {
      const message = {
        type: 'file-delete',
        deviceId: plugin.deviceId,
        filePath: 'deleted.md',
        vaultId: 'test-vault',
        timestamp: Date.now()
      };
      
      await plugin.handleServerMessage(message as any);
      
      // Should not attempt to delete file from own device
      expect(mockApp.vault.getAbstractFileByPath).not.toHaveBeenCalled();
      expect(mockApp.vault.delete).not.toHaveBeenCalled();
    });

    it('should handle file rename message', async () => {
      const message = {
        type: 'file-rename',
        deviceId: 'other-device',
        oldPath: 'old.md',
        newPath: 'new.md',
        vaultId: 'test-vault',
        timestamp: Date.now()
      };
      
      // Mock file exists in vault
      const mockFile = new TFile('old.md');
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      
      await plugin.handleServerMessage(message as any);
      
      // Should call vault.rename with old file and new path
      expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledWith('old.md');
      expect(mockApp.vault.rename).toHaveBeenCalled();
      expect(mockSyncManager.updateServerHash).toHaveBeenCalled();
    });

    it('should ignore file rename messages from same device', async () => {
      const message = {
        type: 'file-rename',
        deviceId: plugin.deviceId,
        oldPath: 'old.md',
        newPath: 'new.md',
        vaultId: 'test-vault',
        timestamp: Date.now()
      };
      
      await plugin.handleServerMessage(message as any);
      
      // Should not attempt to rename file from own device
      expect(mockApp.vault.getAbstractFileByPath).not.toHaveBeenCalled();
      expect(mockApp.vault.rename).not.toHaveBeenCalled();
    });

    it('should ignore messages from same device', async () => {
      const message = {
        type: 'file-change',
        deviceId: plugin.deviceId,
        filePath: 'test.md',
        content: 'content',
        hash: 'hash'
      };
      
      await plugin.handleServerMessage(message as any);
      
      // Should not update hash for own messages
      expect(mockSyncManager.updateServerHash).not.toHaveBeenCalled();
    });
  });

  describe('Cleanup and Disposal', () => {
    beforeEach(async () => {
      await plugin.onload();
    });

    it('should cleanup resources on unload', () => {
      plugin.onunload();
      
      expect(mockSyncManager.dispose).toHaveBeenCalled();
      expect(mockConnectionManager.disconnect).toHaveBeenCalled();
    });

    it('should perform periodic cleanup', () => {
      plugin['performPeriodicCleanup']();
      
      expect(mockSyncManager.cleanup).toHaveBeenCalled();
    });
  });

  describe('Device Registration', () => {
    beforeEach(async () => {
      await plugin.onload();
      // Mock connection state for registration tests
      mockConnectionManager.getConnectionState.mockReturnValue(true);
    });

    it('should register device when connected', () => {
      plugin.registerDevice();
      
      expect(mockConnectionManager.sendMessage).toHaveBeenCalled();
    });

    it('should not register when not connected', () => {
      mockConnectionManager.getConnectionState.mockReturnValue(false);
      
      plugin.registerDevice();
      
      expect(mockConnectionManager.sendMessage).not.toHaveBeenCalled();
    });
  });
});
