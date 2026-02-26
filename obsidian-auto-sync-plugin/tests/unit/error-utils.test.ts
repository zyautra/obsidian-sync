import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ErrorUtils } from '../../src/utils/error-utils';

describe('ErrorUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock console.error to prevent noise in test output
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getErrorMessage', () => {
    it('should extract message from Error instance', () => {
      const error = new Error('Test error message');
      const result = ErrorUtils.getErrorMessage(error);
      expect(result).toBe('Test error message');
    });

    it('should handle string errors', () => {
      const result = ErrorUtils.getErrorMessage('String error');
      expect(result).toBe('String error');
    });

    it('should extract message from object with message property', () => {
      const error = { message: 'Object error message' };
      const result = ErrorUtils.getErrorMessage(error);
      expect(result).toBe('Object error message');
    });

    it('should return fallback for null/undefined', () => {
      expect(ErrorUtils.getErrorMessage(null)).toBe('Unknown error');
      expect(ErrorUtils.getErrorMessage(undefined)).toBe('Unknown error');
    });

    it('should use custom fallback message', () => {
      const result = ErrorUtils.getErrorMessage(null, 'Custom fallback');
      expect(result).toBe('Custom fallback');
    });

    it('should stringify objects without message property', () => {
      const error = { code: 'ECONNREFUSED', details: 'Connection failed' };
      const result = ErrorUtils.getErrorMessage(error);
      expect(result).toBe('{"code":"ECONNREFUSED","details":"Connection failed"}');
    });

    it('should handle objects with toString method', () => {
      const error = {
        toString: () => 'Custom toString result'
      };
      const result = ErrorUtils.getErrorMessage(error);
      expect(result).toBe('Custom toString result');
    });
  });

  describe('logError', () => {
    it('should log error with context', () => {
      const consoleSpy = jest.spyOn(console, 'error');
      const error = new Error('Test error');
      
      ErrorUtils.logError('TestContext', error);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '[TestContext] Test error',
        expect.objectContaining({
          timestamp: expect.any(String),
          context: 'TestContext',
          error: 'Test error',
          originalError: error
        })
      );
    });

    it('should include additional info in log', () => {
      const consoleSpy = jest.spyOn(console, 'error');
      const error = new Error('Test error');
      const additionalInfo = { filePath: 'test.md', userId: '123' };
      
      ErrorUtils.logError('TestContext', error, additionalInfo);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '[TestContext] Test error',
        expect.objectContaining({
          context: 'TestContext',
          error: 'Test error',
          filePath: 'test.md',
          userId: '123'
        })
      );
    });
  });

  describe('getUserFriendlyMessage', () => {
    it('should return network-friendly messages', () => {
      expect(ErrorUtils.getUserFriendlyMessage(new Error('ECONNREFUSED')))
        .toBe('Unable to connect to server. Please check whether the server is running.');
        
      expect(ErrorUtils.getUserFriendlyMessage(new Error('ETIMEDOUT')))
        .toBe('Connection timed out. Please check your network status.');
        
      expect(ErrorUtils.getUserFriendlyMessage(new Error('ENOTFOUND')))
        .toBe('Server address not found. Please check your settings.');
    });

    it('should return WebSocket-friendly messages', () => {
      const error = new Error('WebSocket connection failed');
      const result = ErrorUtils.getUserFriendlyMessage(error);
      expect(result).toBe('There is a WebSocket connection issue. Please verify server settings.');
    });

    it('should return file-friendly messages', () => {
      expect(ErrorUtils.getUserFriendlyMessage(new Error('ENOENT: no such file')))
        .toBe('File not found.');
        
      expect(ErrorUtils.getUserFriendlyMessage(new Error('EACCES: permission denied')))
        .toBe('File permission denied.');
    });

    it('should include context in generic messages', () => {
      const error = new Error('Generic error');
      const result = ErrorUtils.getUserFriendlyMessage(error, 'File sync');
      expect(result).toBe('An error occurred during File sync: Generic error');
    });

    it('should handle Android-specific undefined errors', () => {
      const result = ErrorUtils.getUserFriendlyMessage(undefined);
      expect(result).toBe('Unknown error');
    });
  });

  describe('isRetryableError', () => {
    it('should identify retryable network errors', () => {
      expect(ErrorUtils.isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
      expect(ErrorUtils.isRetryableError(new Error('ECONNRESET'))).toBe(true);
      expect(ErrorUtils.isRetryableError(new Error('ECONNABORTED'))).toBe(true);
      expect(ErrorUtils.isRetryableError(new Error('socket hang up'))).toBe(true);
    });

    it('should identify retryable server errors', () => {
      expect(ErrorUtils.isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
      expect(ErrorUtils.isRetryableError(new Error('service unavailable'))).toBe(true);
    });

    it('should identify non-retryable errors', () => {
      expect(ErrorUtils.isRetryableError(new Error('ECONNREFUSED'))).toBe(false);
      expect(ErrorUtils.isRetryableError(new Error('404 Not Found'))).toBe(false);
      expect(ErrorUtils.isRetryableError(new Error('ENOENT'))).toBe(false);
    });
  });

  describe('getStackTrace', () => {
    it('should extract stack trace from Error', () => {
      const error = new Error('Test error');
      const result = ErrorUtils.getStackTrace(error);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result).toContain('Error: Test error');
    });

    it('should extract stack from object with stack property', () => {
      const error = { stack: 'Custom stack trace' };
      const result = ErrorUtils.getStackTrace(error);
      expect(result).toBe('Custom stack trace');
    });

    it('should return undefined for objects without stack', () => {
      const error = { message: 'No stack' };
      const result = ErrorUtils.getStackTrace(error);
      expect(result).toBeUndefined();
    });

    it('should handle undefined/null gracefully', () => {
      expect(ErrorUtils.getStackTrace(null)).toBeUndefined();
      expect(ErrorUtils.getStackTrace(undefined)).toBeUndefined();
    });
  });

  describe('Android compatibility', () => {
    it('should handle Android-specific error objects', () => {
      // Android   undefined message 
      const androidError: any = { 
        name: 'NetworkError',
        message: undefined,
        code: 'NETWORK_FAILURE'
      };
      
      const message = ErrorUtils.getErrorMessage(androidError);
      expect(message).toBe('{"name":"NetworkError","code":"NETWORK_FAILURE"}');
      
      const friendlyMessage = ErrorUtils.getUserFriendlyMessage(androidError);
      expect(friendlyMessage).toBe('{"name":"NetworkError","code":"NETWORK_FAILURE"}');
    });

    it('should handle completely empty error objects', () => {
      const emptyError = {};
      const message = ErrorUtils.getErrorMessage(emptyError);
      expect(message).toBe('{}');
    });

    it('should handle circular reference errors safely', () => {
      const circularError: any = { message: 'Circular error' };
      circularError.self = circularError;
      
      // Should not throw, should return fallback
      const message = ErrorUtils.getErrorMessage(circularError);
      expect(typeof message).toBe('string');
    });
  });
});
