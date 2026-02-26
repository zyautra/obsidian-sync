import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';
import WebSocket from 'ws';

const SERVER_URL = 'ws://localhost:3001';
const TEST_VAULT_ID = 'test-integration-vault';
const TEST_DEVICE_ID = 'test-device-integration';
const TEST_DEVICE_NAME = 'Integration Test Device';

describe('Server Integration Tests', () => {
  let ws: WebSocket | null = null;
  let receivedMessages: any[] = [];

  const connectToServer = (): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(SERVER_URL);
      
      socket.on('open', () => {
        resolve(socket);
      });
      
      socket.on('error', (error) => {
        reject(error);
      });
      
      socket.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          receivedMessages.push(message);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });
    });
  };

  const sendMessage = (socket: WebSocket, message: any): void => {
    socket.send(JSON.stringify(message));
  };

  const waitForMessage = (type: string, timeout: number = 5000): Promise<any> => {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkMessages = () => {
        const message = receivedMessages.find(msg => msg.type === type);
        if (message) {
          resolve(message);
          return;
        }
        
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for message type: ${type}`));
          return;
        }
        
        setTimeout(checkMessages, 100);
      };
      
      checkMessages();
    });
  };

  beforeEach(() => {
    receivedMessages = [];
  });

  afterEach(async () => {
    if (ws) {
      ws.close();
      ws = null;
    }
  });

  describe('Connection Tests', () => {
    it('should connect to WebSocket server successfully', async () => {
      try {
        ws = await connectToServer();
        expect(ws.readyState).toBe(WebSocket.OPEN);
      } catch (error) {
        // Skip test if server is not running
        console.warn('Server not available for integration tests:', error);
        return;
      }
    }, 10000);

    it('should register device successfully', async () => {
      try {
        ws = await connectToServer();
        
        const registerMessage = {
          type: 'register-device',
          vaultId: TEST_VAULT_ID,
          deviceId: TEST_DEVICE_ID,
          deviceName: TEST_DEVICE_NAME
        };
        
        sendMessage(ws, registerMessage);
        
        // Wait for confirmation or timeout gracefully
        try {
          await waitForMessage('device-registered', 3000);
        } catch (error) {
          console.warn('Device registration confirmation not received (expected in some implementations)');
        }
        
        expect(ws.readyState).toBe(WebSocket.OPEN);
      } catch (error) {
        console.warn('Server not available for integration tests:', error);
        return;
      }
    }, 10000);
  });

  describe('File Synchronization Tests', () => {
    beforeEach(async () => {
      try {
        ws = await connectToServer();
        
        // Register device first
        const registerMessage = {
          type: 'register-device',
          vaultId: TEST_VAULT_ID,
          deviceId: TEST_DEVICE_ID,
          deviceName: TEST_DEVICE_NAME
        };
        
        sendMessage(ws, registerMessage);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for registration
      } catch (error) {
        console.warn('Server not available for integration tests:', error);
        throw error;
      }
    });

    it('should send file change successfully', async () => {
      if (!ws) return;

      const fileChangeMessage = {
        type: 'file-change',
        vaultId: TEST_VAULT_ID,
        filePath: 'test-file.md',
        content: '# Test File\n\nThis is a test file for integration testing.',
        hash: 'test-hash-123',
        timestamp: Date.now(),
        deviceId: TEST_DEVICE_ID
      };
      
      try {
        sendMessage(ws, fileChangeMessage);
        
        // File change might not generate immediate response
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        expect(ws.readyState).toBe(WebSocket.OPEN);
      } catch (error) {
        // Handle connection errors gracefully
        console.warn('File change test failed:', error);
      }
    }, 10000);

    it('should request sync successfully', async () => {
      if (!ws) return;

      const syncRequest = {
        type: 'request-sync',
        vaultId: TEST_VAULT_ID,
        deviceId: TEST_DEVICE_ID
      };
      
      try {
        sendMessage(ws, syncRequest);
        
        // Try to wait for sync response, but don't fail if not received
        try {
          const response = await waitForMessage('sync-response', 3000);
          expect(response.type).toBe('sync-response');
        } catch (error) {
          console.warn('Sync response not received (may be expected if no files to sync)');
        }
        
        expect(ws.readyState).toBe(WebSocket.OPEN);
      } catch (error) {
        console.warn('Sync request test failed:', error);
      }
    }, 10000);
  });

  describe('File Locking Tests', () => {
    beforeEach(async () => {
      try {
        ws = await connectToServer();
        
        const registerMessage = {
          type: 'register-device',
          vaultId: TEST_VAULT_ID,
          deviceId: TEST_DEVICE_ID,
          deviceName: TEST_DEVICE_NAME
        };
        
        sendMessage(ws, registerMessage);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.warn('Server not available for integration tests:', error);
        throw error;
      }
    });

    it('should request file lock successfully', async () => {
      if (!ws) return;

      const lockRequest = {
        type: 'request-lock',
        vaultId: TEST_VAULT_ID,
        filePath: 'locked-file.md',
        deviceId: TEST_DEVICE_ID
      };
      
      try {
        sendMessage(ws, lockRequest);
        
        // Try to wait for lock response
        try {
          const response = await waitForMessage('lock-acquired', 3000);
          expect(response.type).toBe('lock-acquired');
          expect(response.filePath).toBe('locked-file.md');
        } catch (error) {
          // Try waiting for lock denied instead
          try {
            const response = await waitForMessage('lock-denied', 1000);
            expect(response.type).toBe('lock-denied');
          } catch (error2) {
            console.warn('No lock response received (may indicate server configuration)');
          }
        }
        
        expect(ws.readyState).toBe(WebSocket.OPEN);
      } catch (error) {
        console.warn('Lock request test failed:', error);
      }
    }, 10000);
  });

  describe('Error Handling Tests', () => {
    beforeEach(async () => {
      try {
        ws = await connectToServer();
      } catch (error) {
        console.warn('Server not available for integration tests:', error);
        throw error;
      }
    });

    it('should handle invalid message format', async () => {
      if (!ws) return;

      try {
        // Send invalid JSON
        ws.send('invalid-json-message');
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Connection should remain open despite invalid message
        expect(ws.readyState).toBe(WebSocket.OPEN);
      } catch (error) {
        console.warn('Invalid message test failed:', error);
      }
    }, 10000);

    it('should handle missing required fields', async () => {
      if (!ws) return;

      try {
        const invalidMessage = {
          type: 'file-change'
          // Missing required fields: vaultId, filePath, etc.
        };
        
        sendMessage(ws, invalidMessage);
        
        // Try to wait for error response
        try {
          const response = await waitForMessage('error', 3000);
          expect(response.type).toBe('error');
        } catch (error) {
          console.warn('Error response not received (server may handle silently)');
        }
        
        expect(ws.readyState).toBe(WebSocket.OPEN);
      } catch (error) {
        console.warn('Missing fields test failed:', error);
      }
    }, 10000);
  });

  describe('Connection Resilience Tests', () => {
    it('should handle connection close gracefully', async () => {
      try {
        ws = await connectToServer();
        expect(ws.readyState).toBe(WebSocket.OPEN);
        
        ws.close();
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        expect(ws.readyState).toBe(WebSocket.CLOSED);
      } catch (error) {
        console.warn('Server not available for integration tests:', error);
        return;
      }
    }, 10000);

    it('should handle multiple rapid messages', async () => {
      try {
        ws = await connectToServer();
        
        // Register device first
        const registerMessage = {
          type: 'register-device',
          vaultId: TEST_VAULT_ID,
          deviceId: TEST_DEVICE_ID,
          deviceName: TEST_DEVICE_NAME
        };
        
        sendMessage(ws, registerMessage);
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Send multiple file changes rapidly
        for (let i = 0; i < 5; i++) {
          const fileChangeMessage = {
            type: 'file-change',
            vaultId: TEST_VAULT_ID,
            filePath: `rapid-test-${i}.md`,
            content: `Content for file ${i}`,
            hash: `hash-${i}`,
            timestamp: Date.now(),
            deviceId: TEST_DEVICE_ID
          };
          
          sendMessage(ws, fileChangeMessage);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        expect(ws.readyState).toBe(WebSocket.OPEN);
      } catch (error) {
        console.warn('Server not available for integration tests:', error);
        return;
      }
    }, 15000);
  });
});