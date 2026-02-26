import { Injectable } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';
import { SyncErrors } from '../../common/errors/sync-error.types';

export interface FileConflictData {
  vaultId: string;
  filePath: string;
  clientContent: string;
  clientHash: string;
  clientTimestamp?: number;
  previousHash?: string;
  existingFile?: {
    id: string;
    hash: string;
    version: number;
    mtime: Date;
    size: number;
  };
}

export interface ConflictResolution {
  action: 'accept' | 'reject' | 'update_mtime_only' | 'no_change';
  reason: string;
  conflictType?: string;
  clientMtime?: number;
  serverMtime?: number;
  currentVersion?: number;
  currentHash?: string;
  updated?: string;
}

@Injectable()
export class ConflictResolverService {
  constructor(private readonly logger: LoggerService) {}

  /**
   * Resolve conflicts for file updates
   */
  resolveFileConflict(data: FileConflictData): ConflictResolution {
    const { existingFile, clientHash, clientTimestamp, previousHash } = data;

    // If no existing file, always accept (create operation)
    if (!existingFile) {
      this.logger.debug('No existing file, accepting create operation', 'ConflictResolver', {
        filePath: data.filePath,
        vaultId: data.vaultId,
      });
      
      return {
        action: 'accept',
        reason: 'Creating new file',
        updated: 'created',
      };
    }

    const clientMtime = clientTimestamp ? new Date(clientTimestamp) : new Date();

    // Hash-based conflict detection (content changed since client last read)
    if (previousHash && existingFile.hash !== previousHash) {
      this.logger.warn('Hash-based conflict detected', 'ConflictResolver', {
        filePath: data.filePath,
        expectedHash: previousHash,
        actualHash: existingFile.hash,
      });

      return {
        action: 'reject',
        reason: 'File has been modified by another client since last read',
        conflictType: 'hash_mismatch',
        currentVersion: existingFile.version,
        currentHash: existingFile.hash,
      };
    }

    // Same content check
    if (existingFile.hash === clientHash) {
      if (clientMtime > existingFile.mtime) {
        this.logger.debug('Same content, newer client timestamp', 'ConflictResolver', {
          filePath: data.filePath,
          clientMtime: clientMtime.getTime(),
          serverMtime: existingFile.mtime.getTime(),
        });

        return {
          action: 'update_mtime_only',
          reason: 'Same content, updating modification time',
          updated: 'mtime_only',
        };
      } else {
        this.logger.debug('Same content, no changes needed', 'ConflictResolver', {
          filePath: data.filePath,
        });

        return {
          action: 'no_change',
          reason: 'Content and timestamp are up to date',
          updated: 'no_change',
        };
      }
    }

    // Timestamp-based conflict resolution for different content
    if (!previousHash && clientMtime <= existingFile.mtime) {
      this.logger.warn('Timestamp-based conflict detected', 'ConflictResolver', {
        filePath: data.filePath,
        clientMtime: clientMtime.getTime(),
        serverMtime: existingFile.mtime.getTime(),
      });

      return {
        action: 'reject',
        reason: 'Client version is older than server version',
        conflictType: 'older_timestamp',
        clientMtime: clientMtime.getTime(),
        serverMtime: existingFile.mtime.getTime(),
        currentVersion: existingFile.version,
        currentHash: existingFile.hash,
      };
    }

    // Accept the update
    this.logger.debug('Accepting file update', 'ConflictResolver', {
      filePath: data.filePath,
      clientMtime: clientMtime.getTime(),
      serverMtime: existingFile.mtime.getTime(),
      reason: previousHash ? 'Hash validation passed' : 'Client timestamp is newer',
    });

    return {
      action: 'accept',
      reason: 'Update accepted - client version is newer or hash validation passed',
      updated: 'full',
    };
  }

  /**
   * Resolve conflicts for file renames
   */
  resolveRenameConflict(
    vaultId: string,
    oldPath: string,
    newPath: string,
    existingFile?: any,
    targetExists?: boolean
  ): ConflictResolution {
    if (!existingFile) {
      this.logger.warn('Rename conflict: source file does not exist', 'ConflictResolver', {
        vaultId,
        oldPath,
        newPath,
      });

      return {
        action: 'reject',
        reason: 'Cannot rename non-existent file',
        conflictType: 'source_not_found',
      };
    }

    if (targetExists) {
      this.logger.warn('Rename conflict: target path already exists', 'ConflictResolver', {
        vaultId,
        oldPath,
        newPath,
      });

      return {
        action: 'reject',
        reason: 'Target path already exists',
        conflictType: 'target_exists',
      };
    }

    this.logger.debug('Rename operation accepted', 'ConflictResolver', {
      vaultId,
      oldPath,
      newPath,
    });

    return {
      action: 'accept',
      reason: 'Rename operation is valid',
    };
  }

  /**
   * Resolve conflicts for file deletions
   */
  resolveDeleteConflict(
    vaultId: string,
    filePath: string,
    existingFile?: any,
    hasActiveLocks?: boolean
  ): ConflictResolution {
    if (!existingFile) {
      this.logger.debug('Delete operation: file already does not exist', 'ConflictResolver', {
        vaultId,
        filePath,
      });

      return {
        action: 'accept',
        reason: 'File already does not exist',
        updated: 'already_deleted',
      };
    }

    if (hasActiveLocks) {
      this.logger.warn('Delete conflict: file has active locks', 'ConflictResolver', {
        vaultId,
        filePath,
      });

      return {
        action: 'reject',
        reason: 'Cannot delete file with active locks',
        conflictType: 'file_locked',
      };
    }

    this.logger.debug('Delete operation accepted', 'ConflictResolver', {
      vaultId,
      filePath,
    });

    return {
      action: 'accept',
      reason: 'Delete operation is valid',
    };
  }

  /**
   * Generate conflict resolution strategy based on operation type
   */
  getResolutionStrategy(
    operationType: string,
    conflictType: string
  ): { shouldRetry: boolean; retryDelay?: number; clientAction?: string } {
    switch (operationType) {
      case 'UPDATE':
        switch (conflictType) {
          case 'hash_mismatch':
            return {
              shouldRetry: false,
              clientAction: 'fetch_latest_and_merge',
            };
          case 'older_timestamp':
            return {
              shouldRetry: false,
              clientAction: 'fetch_latest_or_force_overwrite',
            };
          default:
            return { shouldRetry: true, retryDelay: 1000 };
        }

      case 'DELETE':
        switch (conflictType) {
          case 'file_locked':
            return {
              shouldRetry: true,
              retryDelay: 5000, // Wait for lock to expire
              clientAction: 'wait_for_lock_release',
            };
          default:
            return { shouldRetry: true, retryDelay: 1000 };
        }

      case 'RENAME':
        switch (conflictType) {
          case 'target_exists':
            return {
              shouldRetry: false,
              clientAction: 'choose_different_name',
            };
          case 'source_not_found':
            return {
              shouldRetry: false,
              clientAction: 'refresh_file_list',
            };
          default:
            return { shouldRetry: true, retryDelay: 1000 };
        }

      default:
        return { shouldRetry: true, retryDelay: 1000 };
    }
  }

  /**
   * Log conflict resolution for monitoring
   */
  logConflictResolution(
    vaultId: string,
    filePath: string,
    operationType: string,
    resolution: ConflictResolution,
    deviceId?: string
  ): void {
    const logLevel = resolution.action === 'reject' ? 'warn' : 'info';
    const message = `Conflict resolution: ${resolution.action} - ${resolution.reason}`;

    if (logLevel === 'warn') {
      this.logger.warn(message, 'ConflictResolver', {
        vaultId,
        filePath,
        operationType,
        deviceId,
        resolution: {
          action: resolution.action,
          conflictType: resolution.conflictType,
          updated: resolution.updated,
        },
      });
    } else {
      this.logger.log(message, 'ConflictResolver', {
        vaultId,
        filePath,
        operationType,
        deviceId,
        resolution: {
          action: resolution.action,
          conflictType: resolution.conflictType,
          updated: resolution.updated,
        },
      });
    }
  }

  /**
   * Get conflict statistics for monitoring
   */
  getConflictStats(): { [key: string]: number } {
    // This would typically be implemented with a metrics collection system
    // For now, return empty stats
    return {
      totalConflicts: 0,
      hashMismatchConflicts: 0,
      timestampConflicts: 0,
      lockConflicts: 0,
      resolvedConflicts: 0,
    };
  }
}