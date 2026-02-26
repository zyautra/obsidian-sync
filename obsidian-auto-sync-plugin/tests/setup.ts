import { jest } from '@jest/globals';
import { MockWebSocket } from './mocks/ws';

global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
};

global.navigator = {
  userAgent: 'test-agent'
} as any;

global.window = {
  setInterval: jest.fn(),
  clearTimeout: jest.fn(),
  setTimeout: jest.fn()
} as any;

// WebSocket mock  
(global as any).WebSocket = MockWebSocket;

process.env.NODE_ENV = 'test';