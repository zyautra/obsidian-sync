import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { App, Setting } from '../mocks/obsidian';

interface AutoSyncSettings {
  serverUrl: string;
  serverPort: number;
  vaultId: string;
  deviceName: string;
  enableSync: boolean;
  syncInterval: number;
}

const DEFAULT_SETTINGS: AutoSyncSettings = {
  serverUrl: 'localhost',
  serverPort: 3001,
  vaultId: '',
  deviceName: '',
  enableSync: false,
  syncInterval: 1000
};

describe('Settings Management', () => {
  let mockApp: App;
  let settings: AutoSyncSettings;

  beforeEach(() => {
    mockApp = new App();
    settings = { ...DEFAULT_SETTINGS };
  });

  describe('Default Settings', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_SETTINGS.serverUrl).toBe('localhost');
      expect(DEFAULT_SETTINGS.serverPort).toBe(3001);
      expect(DEFAULT_SETTINGS.vaultId).toBe('');
      expect(DEFAULT_SETTINGS.deviceName).toBe('');
      expect(DEFAULT_SETTINGS.enableSync).toBe(false);
      expect(DEFAULT_SETTINGS.syncInterval).toBe(1000);
    });

    it('should create settings object with defaults', () => {
      const newSettings = { ...DEFAULT_SETTINGS };
      
      expect(newSettings).toEqual(DEFAULT_SETTINGS);
      expect(newSettings).not.toBe(DEFAULT_SETTINGS); // Should be a copy
    });
  });

  describe('Settings Validation', () => {
    it('should validate server URL', () => {
      const validUrls = ['localhost', '192.168.1.100', 'sync.example.com'];
      const invalidUrls = ['', '   ', 'invalid url with spaces'];

      validUrls.forEach(url => {
        settings.serverUrl = url;
        expect(settings.serverUrl.trim()).toBeTruthy();
      });

      invalidUrls.forEach(url => {
        settings.serverUrl = url;
        if (url.trim() === '') {
          expect(settings.serverUrl.trim()).toBeFalsy();
        } else if (url.includes(' ')) {
          expect(settings.serverUrl).toContain(' ');
        }
      });
    });

    it('should validate server port', () => {
      const validPorts = [3001, 8080, 443, 80];
      const invalidPorts = [0, -1, 65536, 99999];

      validPorts.forEach(port => {
        settings.serverPort = port;
        expect(settings.serverPort).toBeGreaterThan(0);
        expect(settings.serverPort).toBeLessThan(65536);
      });

      invalidPorts.forEach(port => {
        settings.serverPort = port;
        const isValid = port > 0 && port < 65536;
        if (!isValid) {
          expect(settings.serverPort <= 0 || settings.serverPort >= 65536).toBe(true);
        }
      });
    });

    it('should validate vault ID format', () => {
      const validVaultIds = ['vault-123', 'my_vault', 'test-vault-id'];
      const invalidVaultIds = ['', '   ', 'vault with spaces'];

      validVaultIds.forEach(vaultId => {
        settings.vaultId = vaultId;
        expect(settings.vaultId.trim()).toBeTruthy();
        expect(settings.vaultId).not.toContain(' ');
      });

      invalidVaultIds.forEach(vaultId => {
        settings.vaultId = vaultId;
        if (vaultId.trim() === '') {
          expect(settings.vaultId.trim()).toBeFalsy();
        } else if (vaultId.includes(' ')) {
          expect(settings.vaultId).toContain(' ');
        }
      });
    });

    it('should validate sync interval', () => {
      const validIntervals = [100, 1000, 5000, 10000];
      const invalidIntervals = [-1, 0, 50];

      validIntervals.forEach(interval => {
        settings.syncInterval = interval;
        expect(settings.syncInterval).toBeGreaterThanOrEqual(100);
      });

      invalidIntervals.forEach(interval => {
        settings.syncInterval = interval;
        const isValid = interval >= 100;
        if (!isValid) {
          expect(settings.syncInterval < 100).toBe(true);
        }
      });
    });
  });

  describe('Settings Persistence', () => {
    it('should merge saved settings with defaults', () => {
      const savedSettings = {
        serverUrl: 'saved.example.com',
        enableSync: true,
        vaultId: 'saved-vault'
      };

      const mergedSettings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);

      expect(mergedSettings.serverUrl).toBe('saved.example.com');
      expect(mergedSettings.enableSync).toBe(true);
      expect(mergedSettings.vaultId).toBe('saved-vault');
      expect(mergedSettings.serverPort).toBe(DEFAULT_SETTINGS.serverPort); // Unchanged
      expect(mergedSettings.syncInterval).toBe(DEFAULT_SETTINGS.syncInterval); // Unchanged
    });

    it('should handle partial settings data', () => {
      const partialSettings = {
        serverUrl: 'partial.example.com'
      };

      const mergedSettings = Object.assign({}, DEFAULT_SETTINGS, partialSettings);

      expect(mergedSettings.serverUrl).toBe('partial.example.com');
      Object.keys(DEFAULT_SETTINGS).forEach(key => {
        if (key !== 'serverUrl') {
          expect(mergedSettings[key as keyof AutoSyncSettings]).toBe(
            DEFAULT_SETTINGS[key as keyof AutoSyncSettings]
          );
        }
      });
    });

    it('should handle empty saved settings', () => {
      const emptySettings = {};
      const mergedSettings = Object.assign({}, DEFAULT_SETTINGS, emptySettings);

      expect(mergedSettings).toEqual(DEFAULT_SETTINGS);
    });

    it('should handle null/undefined saved settings', () => {
      const nullSettings: any = null;
      const undefinedSettings: any = undefined;

      const mergedFromNull = Object.assign({}, DEFAULT_SETTINGS, nullSettings);
      const mergedFromUndefined = Object.assign({}, DEFAULT_SETTINGS, undefinedSettings);

      expect(mergedFromNull).toEqual(DEFAULT_SETTINGS);
      expect(mergedFromUndefined).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('Settings Updates', () => {
    it('should update individual settings', () => {
      const originalSettings = { ...DEFAULT_SETTINGS };
      
      settings.serverUrl = 'new.example.com';
      settings.serverPort = 8080;
      settings.enableSync = true;

      expect(settings.serverUrl).not.toBe(originalSettings.serverUrl);
      expect(settings.serverPort).not.toBe(originalSettings.serverPort);
      expect(settings.enableSync).not.toBe(originalSettings.enableSync);
    });

    it('should maintain type consistency', () => {
      settings.serverUrl = 'test.com';
      settings.serverPort = 3000;
      settings.vaultId = 'vault-id';
      settings.deviceName = 'device';
      settings.enableSync = true;
      settings.syncInterval = 2000;

      expect(typeof settings.serverUrl).toBe('string');
      expect(typeof settings.serverPort).toBe('number');
      expect(typeof settings.vaultId).toBe('string');
      expect(typeof settings.deviceName).toBe('string');
      expect(typeof settings.enableSync).toBe('boolean');
      expect(typeof settings.syncInterval).toBe('number');
    });
  });

  describe('Settings Serialization', () => {
    it('should serialize settings to JSON', () => {
      settings.serverUrl = 'test.example.com';
      settings.enableSync = true;
      settings.vaultId = 'test-vault';

      const serialized = JSON.stringify(settings);
      const deserialized = JSON.parse(serialized);

      expect(deserialized).toEqual(settings);
      expect(deserialized.serverUrl).toBe(settings.serverUrl);
      expect(deserialized.enableSync).toBe(settings.enableSync);
      expect(deserialized.vaultId).toBe(settings.vaultId);
    });

    it('should handle special characters in serialization', () => {
      settings.deviceName = 'Device with "quotes" and special chars: àáâã';
      settings.vaultId = 'vault_with-special.chars';

      const serialized = JSON.stringify(settings);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.deviceName).toBe(settings.deviceName);
      expect(deserialized.vaultId).toBe(settings.vaultId);
    });
  });

  describe('Connection Settings Validation', () => {
    it('should identify complete connection settings', () => {
      const isComplete = (settings: AutoSyncSettings): boolean => {
        return !!(settings.serverUrl?.trim() && 
                 settings.serverPort > 0 && 
                 settings.vaultId?.trim());
      };

      // Complete settings
      const completeSettings: AutoSyncSettings = {
        ...DEFAULT_SETTINGS,
        serverUrl: 'localhost',
        serverPort: 3001,
        vaultId: 'test-vault'
      };

      expect(isComplete(completeSettings)).toBe(true);

      // Incomplete settings
      const incompleteSettings = [
        { ...completeSettings, serverUrl: '' },
        { ...completeSettings, serverPort: 0 },
        { ...completeSettings, vaultId: '' },
        { ...completeSettings, serverUrl: '   ' },
        { ...completeSettings, vaultId: '   ' }
      ];

      incompleteSettings.forEach(settings => {
        expect(isComplete(settings)).toBe(false);
      });
    });

    it('should validate ready-to-sync conditions', () => {
      const isReadyToSync = (settings: AutoSyncSettings): boolean => {
        return settings.enableSync && 
               !!(settings.serverUrl?.trim() && 
                  settings.serverPort > 0 && 
                  settings.vaultId?.trim());
      };

      const readySettings: AutoSyncSettings = {
        ...DEFAULT_SETTINGS,
        enableSync: true,
        serverUrl: 'localhost',
        serverPort: 3001,
        vaultId: 'test-vault'
      };

      expect(isReadyToSync(readySettings)).toBe(true);

      // Not ready scenarios
      const notReadySettings = [
        { ...readySettings, enableSync: false }, // Sync disabled
        { ...readySettings, serverUrl: '' },     // No server URL
        { ...readySettings, vaultId: '' }        // No vault ID
      ];

      notReadySettings.forEach(settings => {
        expect(isReadyToSync(settings)).toBe(false);
      });
    });
  });
});