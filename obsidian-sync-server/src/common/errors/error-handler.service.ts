import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../modules/logger/logger.service';
import { SyncException, SyncErrorCode, SyncErrors } from './sync-error.types';
import { Prisma } from '@prisma/client';
import * as WebSocket from 'ws';

@Injectable()
export class ErrorHandlerService {
  constructor(private readonly logger: LoggerService) {}

  /**
   * Handle and log errors, returning appropriate SyncException
   */
  handleError(
    error: unknown,
    context: string,
    operation: string,
    metadata?: Record<string, any>
  ): SyncException {
    // If it's already a SyncException, just log and return
    if (error instanceof SyncException) {
      this.logError(error, context, metadata);
      return error;
    }

    // Handle Prisma errors
    if (this.isPrismaError(error)) {
      const syncError = this.handlePrismaError(error as Prisma.PrismaClientKnownRequestError, operation);
      this.logError(syncError, context, metadata);
      return syncError;
    }

    // Handle Node.js errors
    if (error instanceof Error) {
      const syncError = this.handleNodeError(error, operation);
      this.logError(syncError, context, metadata);
      return syncError;
    }

    // Handle unknown errors
    const syncError = SyncErrors.internalError(
      `Unknown error in ${operation}: ${String(error)}`
    );
    this.logError(syncError, context, metadata);
    return syncError;
  }

  /**
   * Send error response via WebSocket
   */
  sendErrorToClient(ws: WebSocket, error: SyncException): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(error.toResponse()));
    }
  }

  /**
   * Log error with appropriate level based on error type
   */
  private logError(error: SyncException, context: string, metadata?: Record<string, any>): void {
    const logData = {
      errorCode: error.code,
      operation: context,
      retryable: error.retryable,
      ...error.details,
      ...metadata,
    };

    // Determine log level based on error type
    if (this.isClientError(error.code)) {
      // Client errors are typically warnings (user mistakes, validation failures)
      this.logger.warn(error.message, context, logData);
    } else if (error.retryable) {
      // Retryable server errors are warnings (temporary issues)
      this.logger.warn(error.message, context, logData);
    } else {
      // Non-retryable server errors are real errors
      this.logger.error(error.message, error.originalError?.stack, context, logData);
    }
  }

  /**
   * Handle Prisma database errors
   */
  private handlePrismaError(
    error: Prisma.PrismaClientKnownRequestError,
    operation: string
  ): SyncException {
    switch (error.code) {
      case 'P2002': // Unique constraint violation
        return new SyncException(
          SyncErrorCode.FILE_ALREADY_EXISTS,
          'Resource already exists',
          { prismaCode: error.code, target: error.meta?.target },
          false,
          error
        );

      case 'P2025': // Record not found
        return new SyncException(
          SyncErrorCode.FILE_NOT_FOUND,
          'Record not found',
          { prismaCode: error.code },
          false,
          error
        );

      case 'P2034': // Transaction failed due to write conflict
        return SyncErrors.transactionFailed(operation, error);

      case 'P1001': // Cannot reach database server
      case 'P1002': // Database server timeout
        return new SyncException(
          SyncErrorCode.SERVICE_UNAVAILABLE,
          'Database temporarily unavailable',
          { prismaCode: error.code },
          true,
          error
        );

      default:
        return SyncErrors.databaseError(operation, error);
    }
  }

  /**
   * Handle Node.js errors
   */
  private handleNodeError(error: Error, operation: string): SyncException {
    // File system errors
    if ('code' in error) {
      const nodeError = error as NodeJS.ErrnoException;
      
      switch (nodeError.code) {
        case 'ENOENT':
          return new SyncException(
            SyncErrorCode.FILE_NOT_FOUND,
            'File or directory not found',
            { path: nodeError.path, syscall: nodeError.syscall },
            false,
            error
          );

        case 'EACCES':
        case 'EPERM':
          return new SyncException(
            SyncErrorCode.UNAUTHORIZED_OPERATION,
            'Permission denied',
            { path: nodeError.path, syscall: nodeError.syscall },
            false,
            error
          );

        case 'ENOSPC':
          return new SyncException(
            SyncErrorCode.STORAGE_ERROR,
            'No space left on device',
            { path: nodeError.path, syscall: nodeError.syscall },
            true,
            error
          );

        case 'EMFILE':
        case 'ENFILE':
          return new SyncException(
            SyncErrorCode.SERVICE_UNAVAILABLE,
            'Too many open files',
            { syscall: nodeError.syscall },
            true,
            error
          );

        default:
          return SyncErrors.storageError(operation, nodeError.path, error);
      }
    }

    // Generic error
    return SyncErrors.internalError(error.message, error);
  }

  /**
   * Check if error is a Prisma error
   */
  private isPrismaError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientRustPanicError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientValidationError
    );
  }

  /**
   * Check if error code represents a client error
   */
  private isClientError(code: SyncErrorCode): boolean {
    const clientErrorCodes = [
      SyncErrorCode.INVALID_MESSAGE_FORMAT,
      SyncErrorCode.MESSAGE_TOO_LARGE,
      SyncErrorCode.RATE_LIMIT_EXCEEDED,
      SyncErrorCode.DEVICE_NOT_FOUND,
      SyncErrorCode.VAULT_NOT_FOUND,
      SyncErrorCode.FILE_NOT_FOUND,
      SyncErrorCode.HASH_MISMATCH,
      SyncErrorCode.FILE_TOO_LARGE,
      SyncErrorCode.INVALID_FILE_PATH,
      SyncErrorCode.UNAUTHORIZED_OPERATION,
      SyncErrorCode.HASH_CONFLICT,
      SyncErrorCode.TIMESTAMP_CONFLICT,
      SyncErrorCode.FILE_ALREADY_EXISTS,
    ];

    return clientErrorCodes.includes(code);
  }

  /**
   * Create error for message validation failures
   */
  createValidationError(field: string, value: any, expected: string): SyncException {
    return SyncErrors.invalidMessageFormat({
      field,
      value: typeof value === 'object' ? '[object]' : String(value),
      expected,
    });
  }
}