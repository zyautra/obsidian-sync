// Error codes for consistent client-server communication
export enum SyncErrorCode {
  // Client errors (4xx equivalent)
  INVALID_MESSAGE_FORMAT = 'INVALID_MESSAGE_FORMAT',
  MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  DEVICE_NOT_FOUND = 'DEVICE_NOT_FOUND',
  VAULT_NOT_FOUND = 'VAULT_NOT_FOUND',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  HASH_MISMATCH = 'HASH_MISMATCH',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_FILE_PATH = 'INVALID_FILE_PATH',
  FILE_ALREADY_LOCKED = 'FILE_ALREADY_LOCKED',
  LOCK_NOT_FOUND = 'LOCK_NOT_FOUND',
  UNAUTHORIZED_OPERATION = 'UNAUTHORIZED_OPERATION',
  
  // Conflict errors
  HASH_CONFLICT = 'HASH_CONFLICT',
  TIMESTAMP_CONFLICT = 'TIMESTAMP_CONFLICT',
  FILE_ALREADY_EXISTS = 'FILE_ALREADY_EXISTS',
  
  // Server errors (5xx equivalent)
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

export interface SyncError {
  code: SyncErrorCode;
  message: string;
  details?: Record<string, any>;
  retryable?: boolean;
  timestamp: number;
}

export interface SyncErrorResponse {
  type: 'error';
  error: SyncError;
}

export class SyncException extends Error {
  constructor(
    public readonly code: SyncErrorCode,
    message: string,
    public readonly details?: Record<string, any>,
    public readonly retryable: boolean = false,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'SyncException';
  }

  toResponse(): SyncErrorResponse {
    return {
      type: 'error',
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        retryable: this.retryable,
        timestamp: Date.now(),
      },
    };
  }
}

// Helper functions for creating common errors
export const SyncErrors = {
  invalidMessageFormat: (details?: Record<string, any>) => 
    new SyncException(
      SyncErrorCode.INVALID_MESSAGE_FORMAT,
      'Invalid message format',
      details,
      false
    ),

  messageTooLarge: (size: number, maxSize: number) => 
    new SyncException(
      SyncErrorCode.MESSAGE_TOO_LARGE,
      'Message exceeds maximum size limit',
      { actualSize: size, maxSize },
      false
    ),

  rateLimitExceeded: (deviceId: string, limit: number, windowMs: number) => 
    new SyncException(
      SyncErrorCode.RATE_LIMIT_EXCEEDED,
      'Rate limit exceeded',
      { deviceId, limit, windowMs },
      true
    ),

  deviceNotFound: (deviceId: string) => 
    new SyncException(
      SyncErrorCode.DEVICE_NOT_FOUND,
      'Device not found',
      { deviceId },
      false
    ),

  fileTooLarge: (size: number, maxSize: number, filePath?: string) => 
    new SyncException(
      SyncErrorCode.FILE_TOO_LARGE,
      'File exceeds maximum size limit',
      { actualSize: size, maxSize, filePath },
      false
    ),

  hashMismatch: (expected: string, actual: string, filePath?: string) => 
    new SyncException(
      SyncErrorCode.HASH_MISMATCH,
      'File content hash mismatch',
      { expectedHash: expected, actualHash: actual, filePath },
      false
    ),

  hashConflict: (serverHash: string, clientHash: string, filePath: string) => 
    new SyncException(
      SyncErrorCode.HASH_CONFLICT,
      'File has been modified by another client',
      { serverHash, clientHash, filePath },
      false
    ),

  timestampConflict: (serverTime: number, clientTime: number, filePath: string) => 
    new SyncException(
      SyncErrorCode.TIMESTAMP_CONFLICT,
      'File has a newer timestamp on server',
      { serverTimestamp: serverTime, clientTimestamp: clientTime, filePath },
      false
    ),

  fileAlreadyLocked: (filePath: string, deviceId: string, expiresAt: Date) => 
    new SyncException(
      SyncErrorCode.FILE_ALREADY_LOCKED,
      'File is currently locked by another device',
      { filePath, lockedBy: deviceId, expiresAt: expiresAt.toISOString() },
      true
    ),

  storageError: (operation: string, filePath?: string, originalError?: Error) => 
    new SyncException(
      SyncErrorCode.STORAGE_ERROR,
      `Storage operation failed: ${operation}`,
      { operation, filePath, originalMessage: originalError?.message },
      true,
      originalError
    ),

  databaseError: (operation: string, originalError?: Error) => 
    new SyncException(
      SyncErrorCode.DATABASE_ERROR,
      `Database operation failed: ${operation}`,
      { operation, originalMessage: originalError?.message },
      true,
      originalError
    ),

  transactionFailed: (operation: string, originalError?: Error) => 
    new SyncException(
      SyncErrorCode.TRANSACTION_FAILED,
      `Transaction failed: ${operation}`,
      { operation, originalMessage: originalError?.message },
      true,
      originalError
    ),

  internalError: (message: string, originalError?: Error) => 
    new SyncException(
      SyncErrorCode.INTERNAL_SERVER_ERROR,
      message,
      { originalMessage: originalError?.message },
      true,
      originalError
    ),
};