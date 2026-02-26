import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from './sync.service';
import { StorageService } from '../storage/storage.service';
import { LoggerService } from '../logger/logger.service';
import { ConnectionManagerService } from './connection-manager.service';
import { ErrorHandlerService } from '../../common/errors/error-handler.service';
import { SyncErrors } from '../../common/errors/sync-error.types';
import { createHash } from 'crypto';
import * as path from 'path';
import * as binaryExtensions from 'binary-extensions';

// Message type interfaces
export interface FileChangeMessage {
  type: 'file-change';
  vaultId: string;
  filePath: string;
  content: string;
  hash: string;
  timestamp: number;
  deviceId: string;
}

export interface RegisterDeviceMessage {
  type: 'register-device';
  vaultId: string;
  deviceId: string;
  deviceName: string;
}

export interface RegisterDeviceResponseMessage {
  type: 'register-device-response';
  vaultId: string;
  deviceId: string;
  success: boolean;
  message?: string;
}

export interface RequestLockMessage {
  type: 'request-lock';
  vaultId: string;
  filePath: string;
  deviceId: string;
}

export interface RequestSyncMessage {
  type: 'request-sync';
  vaultId: string;
  deviceId: string;
  lastSyncTime?: number;
}

export interface FileDeleteMessage {
  type: 'file-delete';
  vaultId: string;
  filePath: string;
  deviceId: string;
}

export interface BinaryFileChangeMessage {
  type: 'binary-file-change';
  vaultId: string;
  filePath: string;
  content: string; // base64 encoded
  hash: string;
  timestamp: number;
  deviceId: string;
}

export interface FileRenameMessage {
  type: 'file-rename';
  vaultId: string;
  oldPath: string;
  newPath: string;
  deviceId: string;
  timestamp: number;
}

export interface ResolveConflictMessage {
  type: 'resolve-conflict';
  vaultId: string;
  filePath: string;
  resolution: 'accept-client' | 'accept-server' | 'merge';
  content?: string;
  hash?: string;
  deviceId: string;
  timestamp: number;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  deviceId?: string;
  timestamp: number;
}

export interface ChunkUploadStartMessage {
  type: 'chunk-upload-start';
  vaultId: string;
  filePath: string;
  fileHash: string;
  fileSize: number;
  totalChunks: number;
  deviceId: string;
  timestamp: number;
}

export interface ChunkDataMessage {
  type: 'chunk-data';
  vaultId: string;
  filePath: string;
  chunkIndex: number;
  chunkHash: string;
  chunkSize: number;
  deviceId: string;
}

export interface ChunkUploadCompleteMessage {
  type: 'chunk-upload-complete';
  vaultId: string;
  filePath: string;
  fileHash?: string;
  hash?: string;
  fileSize?: number;
  totalSize?: number;
  deviceId: string;
  timestamp: number;
}

export interface ChunkUploadResponseMessage {
  type: 'chunk-upload-response';
  filePath: string;
  success: boolean;
  chunkIndex: number; // -1 means complete
  missingChunks?: number[];
  message?: string;
}

export type ClientMessage = 
  | FileChangeMessage 
  | BinaryFileChangeMessage
  | RegisterDeviceMessage 
  | RequestLockMessage 
  | RequestSyncMessage 
  | FileDeleteMessage 
  | FileRenameMessage
  | ResolveConflictMessage
  | HeartbeatMessage
  | ChunkUploadStartMessage
  | ChunkDataMessage
  | ChunkUploadCompleteMessage;

@Injectable()
export class MessageHandlerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncService: SyncService,
    private readonly storage: StorageService,
    private readonly logger: LoggerService,
    private readonly connectionManager: ConnectionManagerService,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  /**
   * Check if file is binary based on extension
   */
  private isBinaryFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase().slice(1); // Remove the dot
    return binaryExtensions.includes(ext);
  }

  /**
   * Handle device registration
   */
  async handleRegisterDevice(message: RegisterDeviceMessage): Promise<any> {
    const { vaultId, deviceId, deviceName } = message;
    
    try {
      // First ensure vault exists
      await this.prisma.vault.upsert({
        where: { id: vaultId },
        update: {},
        create: {
          id: vaultId,
          name: `Vault-${vaultId.substring(0, 8)}`,
        },
      });

      // Register or update device in database
      const device = await this.prisma.device.upsert({
        where: { deviceId },
        update: {
          deviceName,
          isOnline: true,
          lastSeen: new Date(),
        },
        create: {
          vaultId,
          deviceId,
          deviceName,
          isOnline: true,
          lastSeen: new Date(),
        },
      });

      this.logger.logWebSocketEvent('device_registered', undefined, deviceId, vaultId, { deviceName });
      
      return {
        type: 'register-device-response',
        vaultId,
        deviceId,
        success: true,
        message: 'Device registered successfully',
      };
    } catch (error) {
      throw this.errorHandler.handleError(
        error,
        'MessageHandler',
        'register_device',
        { deviceId, deviceName, vaultId }
      );
    }
  }

  /**
   * Handle file change requests
   */
  async handleFileChange(message: FileChangeMessage): Promise<{ broadcastMessage?: any; response?: any }> {
    const { vaultId, filePath, content, hash, timestamp, deviceId } = message;
    
    try {
      // Verify hash
      const calculatedHash = createHash('sha256').update(content).digest('hex');
      if (hash !== calculatedHash) {
        throw SyncErrors.hashMismatch(hash, calculatedHash, filePath);
      }

      // Use syncService to process file change
      const result = await this.syncService.processFileChange({
        vaultId,
        deviceId,
        filePath,
        content,
        operationType: 'UPDATE',
        previousHash: undefined,
        clientTimestamp: timestamp,
      });

      // Get the actual device record ID for foreign key constraint
      const device = await this.prisma.device.findUnique({
        where: { deviceId },
        select: { id: true }
      });

      if (!device) {
        throw SyncErrors.deviceNotFound(deviceId);
      }

      // Record sync operation
      await this.prisma.syncOperation.create({
        data: {
          vaultId,
          deviceId: device.id,
          operationType: 'UPDATE',
          filePath,
          newHash: hash,
          timestamp: new Date(timestamp),
          status: 'applied',
        },
      });

      this.logger.logFileOperation('UPDATE', filePath, deviceId, vaultId, true);

      // Return broadcast message for gateway to send
      return {
        broadcastMessage: {
          type: 'file-change',
          vaultId,
          filePath,
          content,
          hash,
          timestamp,
          deviceId,
        },
        response: {
          type: 'file-change-response',
          success: true,
          filePath,
          hash: result.hash,
          version: result.version,
        }
      };
    } catch (error) {
      throw this.errorHandler.handleError(
        error,
        'MessageHandler',
        'file_change',
        { filePath, deviceId, vaultId }
      );
    }
  }

  /**
   * Handle file delete requests
   */
  async handleFileDelete(message: FileDeleteMessage): Promise<{ broadcastMessage?: any; response?: any }> {
    const { vaultId, filePath, deviceId } = message;
    
    try {
      // Use syncService to process file deletion
      const result = await this.syncService.processFileChange({
        vaultId,
        deviceId,
        filePath,
        content: '',
        operationType: 'DELETE',
      });

      // Check if result is a SyncException (error) or success result
      if ('success' in result && result.success) {
        this.logger.logFileOperation('DELETE', filePath, deviceId, vaultId, true);
        
        return {
          broadcastMessage: {
            type: 'file-delete',
            vaultId,
            filePath,
            timestamp: Date.now(),
          },
          response: {
            type: 'file-delete-success',
            success: true,
            filePath,
          }
        };
      } else {
        throw SyncErrors.internalError('File not found or failed to delete');
      }
    } catch (error) {
      throw this.errorHandler.handleError(
        error,
        'MessageHandler',
        'file_delete',
        { deviceId, filePath, vaultId }
      );
    }
  }

  /**
   * Handle file lock requests
   */
  async handleRequestLock(message: RequestLockMessage): Promise<any> {
    const { vaultId, filePath, deviceId } = message;
    
    try {
      const lockResult = await this.syncService.requestFileLock(vaultId, filePath, deviceId);
      
      if (lockResult) {
        return {
          type: 'lock-acquired',
          vaultId,
          filePath,
          deviceId,
          expiresAt: new Date(Date.now() + 30000).toISOString(),
        };
      } else {
        return {
          type: 'lock-denied',
          vaultId,
          filePath,
          reason: 'File already locked',
        };
      }
    } catch (error) {
      throw this.errorHandler.handleError(
        error,
        'MessageHandler',
        'request_lock',
        { filePath, deviceId, vaultId }
      );
    }
  }

  /**
   * Handle sync requests
   */
  async handleRequestSync(message: RequestSyncMessage): Promise<{ response: any; syncComplete?: any }> {
    const { vaultId, deviceId, lastSyncTime } = message;
    
    try {
      const files = await this.prisma.file.findMany({
        where: {
          vaultId,
          ...(lastSyncTime && {
            updatedAt: {
              gt: new Date(lastSyncTime),
            },
          }),
        },
        select: {
          path: true,
          hash: true,
          mtime: true,
          version: true,
          size: true,
          vaultId: true,
        },
      });

      // Read file contents from storage
      const filesWithContent = await Promise.all(
        files.map(async (file) => {
          try {
            const content = await this.storage.readFile(file.vaultId, file.path);
            return {
              path: file.path,
              content,
              hash: file.hash,
              mtime: file.mtime.getTime(),
              version: file.version,
              size: file.size,
              isBinary: this.isBinaryFile(file.path),
            };
          } catch (error) {
            this.logger.error(`Failed to read file content: ${file.path}`, error.stack, 'MessageHandler');
            return {
              path: file.path,
              content: '',
              hash: file.hash,
              mtime: file.mtime.getTime(),
              version: file.version,
              size: file.size,
              isBinary: this.isBinaryFile(file.path),
            };
          }
        })
      );

      this.logger.logWebSocketEvent('sync_response_sent', undefined, deviceId, vaultId, { fileCount: files.length });

      return {
        response: {
          type: 'sync-response',
          vaultId,
          deviceId: 'server',
          files: filesWithContent,
        },
        syncComplete: {
          type: 'initial-sync-complete',
          vaultId,
          deviceId,
          summary: {
            serverToClient: filesWithContent.length,
            clientToServer: 0,
            conflicts: 0,
            errors: 0,
          },
        }
      };
    } catch (error) {
      throw this.errorHandler.handleError(
        error,
        'MessageHandler',
        'request_sync',
        { deviceId, vaultId, lastSyncTime }
      );
    }
  }

  /**
   * Handle binary file changes
   */
  async handleBinaryFileChange(message: BinaryFileChangeMessage): Promise<{ broadcastMessage?: any; response?: any }> {
    const { vaultId, filePath, content, hash, timestamp, deviceId } = message;
    
    try {
      // Verify hash - client now sends hash of original binary data
      // So we decode base64 first and calculate hash of the original binary
      let calculatedHash: string;
      try {
        const binaryData = Buffer.from(content, 'base64');
        calculatedHash = createHash('sha256').update(binaryData).digest('hex');
      } catch (error) {
        this.logger.error('Failed to decode base64 content', error.stack, 'MessageHandler', {
          filePath,
          contentLength: content.length,
        });
        throw SyncErrors.internalError('Invalid base64 content');
      }
      
      if (hash !== calculatedHash) {
        throw SyncErrors.hashMismatch(hash, calculatedHash, filePath);
      }

      // Use syncService to process binary file change
      const result = await this.syncService.processFileChange({
        vaultId,
        deviceId,
        filePath,
        content,
        operationType: 'UPDATE',
        clientTimestamp: timestamp,
      });

      this.logger.logFileOperation('BINARY_UPDATE', filePath, deviceId, vaultId, true);

      return {
        broadcastMessage: {
          type: 'binary-file-change',
          vaultId,
          filePath,
          content,
          hash,
          timestamp,
          deviceId,
        },
        response: {
          type: 'file-change-response',
          success: true,
          filePath,
          hash: result.hash,
          version: result.version,
        }
      };
    } catch (error) {
      throw this.errorHandler.handleError(
        error,
        'MessageHandler',
        'binary_file_change',
        { filePath, deviceId, vaultId }
      );
    }
  }

  /**
   * Persist metadata for a successfully completed chunk upload
   */
  async recordChunkUploadResult(params: {
    vaultId: string;
    deviceId: string;
    filePath: string;
    fileHash: string;
    fileSize: number;
    timestamp: number;
  }): Promise<void> {
    const { vaultId, deviceId, filePath, fileHash, fileSize, timestamp } = params;

    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      select: { id: true },
    });

    if (!device) {
      throw SyncErrors.deviceNotFound(deviceId);
    }

    const existing = await this.prisma.file.findFirst({
      where: { vaultId, path: filePath },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.file.update({
        where: { id: existing.id },
        data: {
          hash: fileHash,
          size: fileSize,
          mtime: new Date(timestamp),
          version: { increment: 1 },
        },
      });
    } else {
      await this.prisma.file.create({
        data: {
          vaultId,
          path: filePath,
          hash: fileHash,
          size: fileSize,
          mtime: new Date(timestamp),
        },
      });
    }

    await this.prisma.syncOperation.create({
      data: {
        vaultId,
        deviceId: device.id,
        operationType: 'UPDATE',
        filePath,
        newHash: fileHash,
        timestamp: new Date(timestamp),
        status: 'applied',
      },
    });
  }

  /**
   * Handle file rename requests
   */
  async handleFileRename(message: FileRenameMessage): Promise<{ broadcastMessage?: any; response?: any }> {
    const { vaultId, oldPath, newPath, deviceId, timestamp } = message;
    
    try {
      // Use syncService to process rename operation
      const result = await this.syncService.processFileChange({
        vaultId,
        deviceId,
        filePath: oldPath,
        newPath,
        content: '', // Content will be read from storage
        operationType: 'RENAME',
        clientTimestamp: timestamp,
      });

      this.logger.logFileOperation('RENAME', `${oldPath} -> ${newPath}`, deviceId, vaultId, true);

      return {
        broadcastMessage: {
          type: 'file-rename',
          vaultId,
          oldPath,
          newPath,
          timestamp,
          deviceId,
        },
        response: {
          type: 'file-change-response',
          success: true,
          filePath: newPath,
          hash: result.hash,
          version: result.version,
        }
      };
    } catch (error) {
      throw this.errorHandler.handleError(
        error,
        'MessageHandler',
        'file_rename',
        { oldPath, newPath, deviceId, vaultId }
      );
    }
  }

  /**
   * Handle conflict resolution requests
   */
  async handleResolveConflict(message: ResolveConflictMessage): Promise<{ broadcastMessage?: any; response?: any }> {
    const { vaultId, filePath, resolution, content, hash, deviceId, timestamp } = message;
    
    try {
      let result;
      
      switch (resolution) {
        case 'accept-client':
          if (!content || !hash) {
            throw SyncErrors.invalidMessageFormat({ field: 'content/hash', expected: 'required for accept-client' });
          }
          
          result = await this.syncService.processFileChange({
            vaultId,
            deviceId,
            filePath,
            content,
            operationType: 'UPDATE',
            clientTimestamp: timestamp,
          });
          break;
          
        case 'accept-server':
          // Server version is already current, just acknowledge
          const existingFile = await this.prisma.file.findFirst({
            where: { vaultId, path: filePath }
          });
          
          if (!existingFile) {
            throw SyncErrors.internalError(`File not found: ${filePath}`);
          }
          
          result = {
            success: true,
            version: existingFile.version,
            hash: existingFile.hash,
          };
          break;
          
        case 'merge':
          // For now, treat merge as accept-client
          // TODO: Implement proper merge logic
          if (!content || !hash) {
            throw SyncErrors.invalidMessageFormat({ field: 'content/hash', expected: 'required for merge' });
          }
          
          result = await this.syncService.processFileChange({
            vaultId,
            deviceId,
            filePath,
            content,
            operationType: 'UPDATE',
            clientTimestamp: timestamp,
          });
          break;
          
        default:
          throw SyncErrors.invalidMessageFormat({ 
            field: 'resolution', 
            value: resolution, 
            expected: 'accept-client, accept-server, or merge' 
          });
      }

      this.logger.logFileOperation(`CONFLICT_RESOLVED_${resolution.toUpperCase()}`, filePath, deviceId, vaultId, true);

      return {
        broadcastMessage: {
          type: 'file-change',
          vaultId,
          filePath,
          content: content || '',
          hash: result.hash,
          timestamp,
          deviceId,
        },
        response: {
          type: 'file-change-response',
          success: true,
          filePath,
          hash: result.hash,
          version: result.version,
          conflictResolved: true,
          resolution,
        }
      };
    } catch (error) {
      throw this.errorHandler.handleError(
        error,
        'MessageHandler',
        'resolve_conflict',
        { filePath, resolution, deviceId, vaultId }
      );
    }
  }

  /**
   * Handle heartbeat messages
   */
  handleHeartbeat(message: HeartbeatMessage): any {
    return {
      type: 'heartbeat-response',
      timestamp: Date.now(),
    };
  }

  /**
   * Handle chunk upload start
   */
  handleChunkUploadStart(message: ChunkUploadStartMessage): ChunkUploadResponseMessage {
    try {
      // Create unique session ID
      const sessionId = `${message.vaultId}-${message.filePath}-${Date.now()}`;
      
      this.logger.log('Chunk upload session starting', 'MessageHandler', {
        vaultId: message.vaultId,
        filePath: message.filePath,
        fileSize: message.fileSize,
        totalChunks: message.totalChunks,
        deviceId: message.deviceId,
        sessionId,
      });

      return {
        type: 'chunk-upload-response',
        filePath: message.filePath,
        success: true,
        chunkIndex: -1, // -1 indicates session ready
        message: `Session ${sessionId} ready for chunks`,
      };
    } catch (error) {
      this.logger.error('Failed to start chunk upload session', error.stack, 'MessageHandler', {
        filePath: message.filePath,
        error: error.message,
      });

      return {
        type: 'chunk-upload-response',
        filePath: message.filePath,
        success: false,
        chunkIndex: -1,
        message: `Failed to start session: ${error.message}`,
      };
    }
  }

  /**
   * Handle chunk data metadata (binary data comes separately)
   */
  handleChunkData(message: ChunkDataMessage): ChunkUploadResponseMessage {
    try {
      this.logger.debug('Chunk data metadata received', 'MessageHandler', {
        vaultId: message.vaultId,
        filePath: message.filePath,
        chunkIndex: message.chunkIndex,
        chunkSize: message.chunkSize,
        chunkHash: message.chunkHash,
      });

      return {
        type: 'chunk-upload-response',
        filePath: message.filePath,
        success: true,
        chunkIndex: message.chunkIndex,
        message: 'Ready for binary data',
      };
    } catch (error) {
      this.logger.error('Failed to process chunk metadata', error.stack, 'MessageHandler', {
        filePath: message.filePath,
        chunkIndex: message.chunkIndex,
        error: error.message,
      });

      return {
        type: 'chunk-upload-response',
        filePath: message.filePath,
        success: false,
        chunkIndex: message.chunkIndex,
        message: `Chunk metadata failed: ${error.message}`,
      };
    }
  }

  /**
   * Handle chunk upload complete
   */
  handleChunkUploadComplete(message: ChunkUploadCompleteMessage): ChunkUploadResponseMessage {
    try {
      this.logger.log('Chunk upload completion requested', 'MessageHandler', {
        vaultId: message.vaultId,
        filePath: message.filePath,
        fileHash: message.fileHash,
        deviceId: message.deviceId,
      });

      // This will be implemented with the actual chunk session service
      // For now, return success
      return {
        type: 'chunk-upload-response',
        filePath: message.filePath,
        success: true,
        chunkIndex: -1, // -1 indicates complete
        message: 'File upload completed successfully',
      };
    } catch (error) {
      this.logger.error('Failed to complete chunk upload', error.stack, 'MessageHandler', {
        filePath: message.filePath,
        error: error.message,
      });

      return {
        type: 'chunk-upload-response',
        filePath: message.filePath,
        success: false,
        chunkIndex: -1,
        message: `Upload completion failed: ${error.message}`,
      };
    }
  }
}
