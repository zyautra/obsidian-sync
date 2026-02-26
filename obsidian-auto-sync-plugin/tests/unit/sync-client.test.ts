import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock ws module before importing SyncClient
jest.mock('ws');

import { SyncClient } from '../../src/sync-client';

describe('SyncClient', () => {
  let syncClient: SyncClient;
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      serverUrl: 'localhost',
      serverPort: 3001,
      vaultId: 'test-vault-id',
      deviceId: 'test-device-id',
      deviceName: 'Test Device'
    };
    
    syncClient = new SyncClient(mockConfig);
  });

  afterEach(() => {
    syncClient.disconnect();
    jest.clearAllMocks();
  });

  describe('Connection Management', () => {
    it('should connect to WebSocket server successfully', async () => {
      const connected = await syncClient.connect();
      expect(connected).toBe(true);
      expect(syncClient.isConnectedToServer()).toBe(true);
    });

    it('should emit connected event on successful connection', async () => {
      const connectedHandler = jest.fn();
      syncClient.on('connected', connectedHandler);
      
      await syncClient.connect();
      
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(connectedHandler).toHaveBeenCalled();
    });

    it('should disconnect gracefully', async () => {
      await syncClient.connect();
      expect(syncClient.isConnectedToServer()).toBe(true);
      
      syncClient.disconnect();
      expect(syncClient.isConnectedToServer()).toBe(false);
    });

    it('should handle connection errors', async () => {
      const errorConfig = {
        ...mockConfig,
        serverUrl: 'invalid-url'
      };
      
      const errorClient = new SyncClient(errorConfig);
      
      // Register error handler to catch the error
      let caughtError: Error | null = null;
      errorClient.on('error', (error: Error) => {
        caughtError = error;
      });
      
      try {
        await errorClient.connect();
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.message).toBe('WebSocket connection failed');
      }
    });
  });

  describe('File Synchronization', () => {
    beforeEach(async () => {
      await syncClient.connect();
    });

    it('should send file changes when connected', () => {
      const filePath = 'test.md';
      const content = 'Test content';
      
      expect(() => {
        syncClient.sendFileChange(filePath, content);
      }).not.toThrow();
    });

    it('should throw error when sending file changes while disconnected', () => {
      syncClient.disconnect();
      
      expect(() => {
        syncClient.sendFileChange('test.md', 'content');
      }).toThrow('Not connected to server');
    });

    it('should request sync when connected', () => {
      expect(() => {
        syncClient.requestSync();
      }).not.toThrow();
    });

    it('should throw error when requesting sync while disconnected', () => {
      syncClient.disconnect();
      
      expect(() => {
        syncClient.requestSync();
      }).toThrow('Not connected to server');
    });
  });

  describe('Hash Generation', () => {
    it('should generate consistent hash for same content', () => {
      const content = 'Test content for hashing';
      const hash1 = syncClient.generateFileHash(content);
      const hash2 = syncClient.generateFileHash(content);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toBeTruthy();
      expect(typeof hash1).toBe('string');
    });

    it('should generate different hashes for different content', () => {
      const content1 = 'First content';
      const content2 = 'Second content';
      
      const hash1 = syncClient.generateFileHash(content1);
      const hash2 = syncClient.generateFileHash(content2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should generate hash for empty content', () => {
      const hash = syncClient.generateFileHash('');
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
    });
  });

  describe('Event Handling', () => {
    it('should register and trigger event handlers', () => {
      const handler = jest.fn();
      syncClient.on('test-event', handler);
      
      (syncClient as any).emit('test-event', 'test-data');
      
      expect(handler).toHaveBeenCalledWith('test-data');
    });

    it('should remove event handlers', () => {
      const handler = jest.fn();
      syncClient.on('test-event', handler);
      syncClient.off('test-event', handler);
      
      (syncClient as any).emit('test-event');
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle multiple handlers for same event', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      syncClient.on('test-event', handler1);
      syncClient.on('test-event', handler2);
      
      (syncClient as any).emit('test-event');
      
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('Message Processing', () => {
    beforeEach(async () => {
      await syncClient.connect();
    });

    it('should handle file-change messages', () => {
      const fileChangeHandler = jest.fn();
      syncClient.on('file-change', fileChangeHandler);
      
      const mockMessage = {
        type: 'file-change',
        filePath: 'test.md',
        content: 'new content',
        hash: 'testhash'
      };
      
      (syncClient as any).handleMessage(mockMessage);
      expect(fileChangeHandler).toHaveBeenCalledWith(mockMessage);
    });

    it('should handle sync-response messages', () => {
      const syncResponseHandler = jest.fn();
      syncClient.on('sync-response', syncResponseHandler);
      
      const mockMessage = {
        type: 'sync-response',
        files: [] as any[]
      };
      
      (syncClient as any).handleMessage(mockMessage);
      expect(syncResponseHandler).toHaveBeenCalledWith(mockMessage);
    });

    it('should handle server error messages', () => {
      const errorHandler = jest.fn();
      syncClient.on('server-error', errorHandler);
      
      const mockMessage = {
        type: 'error',
        message: 'Test error'
      };
      
      (syncClient as any).handleMessage(mockMessage);
      expect(errorHandler).toHaveBeenCalledWith(mockMessage);
    });
  });
});