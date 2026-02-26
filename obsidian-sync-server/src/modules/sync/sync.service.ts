import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ConfigService } from '../config/config.service';
import { ErrorHandlerService } from '../../common/errors/error-handler.service';
import { ConflictResolverService } from './conflict-resolver.service';
import { FileLockService } from './file-lock.service';
import { SyncErrors } from '../../common/errors/sync-error.types';

export interface FileOperationData {
  vaultId: string;
  deviceId: string;
  filePath: string;
  content: string;
  operationType: 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME';
  previousHash?: string;
  clientTimestamp?: number;
  newPath?: string;
}

export interface FileOperationResult {
  success: boolean;
  version: number;
  hash: string;
  currentVersion?: number;
  currentHash?: string;
  conflictType?: string;
  clientMtime?: number;
  serverMtime?: number;
  updated?: string;
}

/**
 * Simplified SyncService - focuses on orchestrating file operations
 * Delegates complex logic to specialized services
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly configService: ConfigService,
    private readonly errorHandler: ErrorHandlerService,
    private readonly conflictResolver: ConflictResolverService,
    private readonly fileLockService: FileLockService,
  ) {}

  /**
   * Process file change operation (main entry point)
   */
  async processFileChange(data: FileOperationData): Promise<FileOperationResult> {
    try {
      // Validate device exists
      const device = await this.validateDevice(data.deviceId);
      
      // Route to appropriate operation handler
      switch (data.operationType) {
        case 'DELETE':
          return await this.processDeleteOperation(data, device.id);
        case 'RENAME':
          if (!data.newPath) {
            throw SyncErrors.internalError('New path required for rename operation');
          }
          return await this.processRenameOperation(data, device.id);
        case 'CREATE':
        case 'UPDATE':
        default:
          return await this.processCreateUpdateOperation(data, device.id);
      }
    } catch (error) {
      throw this.errorHandler.handleError(error, 'SyncService', 'processFileChange', {
        vaultId: data.vaultId,
        deviceId: data.deviceId,
        filePath: data.filePath,
        operationType: data.operationType,
      });
    }
  }

  /**
   * Register device and vault
   */
  async registerDevice(vaultName: string, deviceId: string, deviceName: string) {
    try {
      let vault = await this.prisma.vault.findUnique({
        where: { name: vaultName },
      });

      if (!vault) {
        vault = await this.prisma.vault.create({
          data: { name: vaultName },
        });
        // Ensure vault directory exists in storage
        await this.storage.ensureVaultDirectory(vault.id);
      }

      const device = await this.prisma.device.upsert({
        where: { deviceId },
        update: {
          isOnline: true,
          lastSeen: new Date(),
        },
        create: {
          vaultId: vault.id,
          deviceId,
          deviceName,
          isOnline: true,
        },
      });

      return { vault, device };
    } catch (error) {
      throw this.errorHandler.handleError(error, 'SyncService', 'registerDevice', {
        vaultName,
        deviceId,
        deviceName,
      });
    }
  }

  /**
   * Set device offline and clean up locks
   */
  async setDeviceOffline(deviceId: string) {
    try {
      const releasedLocks = await this.fileLockService.releaseAllDeviceLocks(deviceId);
      
      // Update device status
      await this.prisma.device.updateMany({
        where: { deviceId },
        data: { 
          isOnline: false,
          lastSeen: new Date(),
        },
      });

      return { deviceId, releasedLocks };
    } catch (error) {
      throw this.errorHandler.handleError(error, 'SyncService', 'setDeviceOffline', {
        deviceId,
      });
    }
  }

  /**
   * Update device heartbeat
   */
  async updateDeviceHeartbeat(deviceId: string) {
    try {
      await this.prisma.device.updateMany({
        where: { deviceId },
        data: { lastSeen: new Date() },
      });
    } catch (error) {
      throw this.errorHandler.handleError(error, 'SyncService', 'updateDeviceHeartbeat', {
        deviceId,
      });
    }
  }

  /**
   * Request file lock (delegated to FileLockService)
   */
  async requestFileLock(vaultId: string, filePath: string, deviceId: string) {
    return await this.fileLockService.requestFileLock(vaultId, filePath, deviceId);
  }

  /**
   * Release file lock (delegated to FileLockService)
   */
  async releaseFileLock(vaultId: string, filePath: string, deviceId?: string) {
    return await this.fileLockService.releaseFileLock(vaultId, filePath, deviceId);
  }

  /**
   * Get vault files
   */
  async getVaultFiles(vaultId: string) {
    try {
      return await this.prisma.file.findMany({
        where: { vaultId },
        orderBy: { path: 'asc' },
      });
    } catch (error) {
      throw this.errorHandler.handleError(error, 'SyncService', 'getVaultFiles', {
        vaultId,
      });
    }
  }

  /**
   * Private helper methods
   */

  private async validateDevice(deviceId: string) {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      select: { id: true }
    });

    if (!device) {
      throw SyncErrors.deviceNotFound(deviceId);
    }

    return device;
  }

  private async processDeleteOperation(
    data: FileOperationData,
    deviceDbId: string
  ): Promise<FileOperationResult> {
    return await this.prisma.$transaction(async (tx) => {
      // Create sync operation record
      const syncOp = await tx.syncOperation.create({
        data: {
          vaultId: data.vaultId,
          deviceId: deviceDbId,
          operationType: 'DELETE',
          filePath: data.filePath,
          status: 'pending',
        },
      });

      try {
        const existingFile = await tx.file.findFirst({
          where: {
            vaultId: data.vaultId,
            path: data.filePath,
          },
        });

        // Use conflict resolver to validate delete operation
        const resolution = this.conflictResolver.resolveDeleteConflict(
          data.vaultId,
          data.filePath,
          existingFile
        );

        if (resolution.action === 'reject') {
          await tx.syncOperation.update({
            where: { id: syncOp.id },
            data: { status: 'conflicted' },
          });
          
          throw SyncErrors.internalError(resolution.reason);
        }

        let result: FileOperationResult;

        if (existingFile) {
          // Delete from database first
          await tx.file.delete({
            where: { id: existingFile.id },
          });
          
          // Clean up any file locks
          await tx.fileLock.deleteMany({
            where: { fileId: existingFile.id },
          });
        }

        result = { success: true, version: 0, hash: '' };

        // Update sync operation status
        await tx.syncOperation.update({
          where: { id: syncOp.id },
          data: { status: 'applied' },
        });

        // Delete from storage after transaction commits
        if (existingFile) {
          this.deleteFileFromStorage(data.vaultId, data.filePath);
        }

        return result;
      } catch (error) {
        await tx.syncOperation.update({
          where: { id: syncOp.id },
          data: { status: 'failed' },
        });
        throw error;
      }
    });
  }

  private async processRenameOperation(
    data: FileOperationData,
    deviceDbId: string
  ): Promise<FileOperationResult> {
    return await this.prisma.$transaction(async (tx) => {
      // Create sync operation record
      const syncOp = await tx.syncOperation.create({
        data: {
          vaultId: data.vaultId,
          deviceId: deviceDbId,
          operationType: 'RENAME',
          filePath: data.filePath,
          status: 'pending',
        },
      });

      try {
        const existingFile = await tx.file.findFirst({
          where: {
            vaultId: data.vaultId,
            path: data.filePath,
          },
        });

        const targetExists = await tx.file.findFirst({
          where: {
            vaultId: data.vaultId,
            path: data.newPath!,
          },
        });

        // Use conflict resolver to validate rename operation
        const resolution = this.conflictResolver.resolveRenameConflict(
          data.vaultId,
          data.filePath,
          data.newPath!,
          existingFile,
          !!targetExists
        );

        if (resolution.action === 'reject') {
          await tx.syncOperation.update({
            where: { id: syncOp.id },
            data: { status: 'conflicted' },
          });
          
          throw SyncErrors.internalError(resolution.reason);
        }

        // Update database first
        const updatedFile = await tx.file.update({
          where: { id: existingFile.id },
          data: {
            path: data.newPath!,
            mtime: new Date(),
            version: { increment: 1 },
          },
        });

        await tx.syncOperation.update({
          where: { id: syncOp.id },
          data: { newHash: updatedFile.hash },
        });

        await tx.syncOperation.update({
          where: { id: syncOp.id },
          data: { status: 'applied' },
        });

        const result = { success: true, version: updatedFile.version, hash: updatedFile.hash };

        // File operations after transaction
        this.renameFileInStorage(data.vaultId, data.filePath, data.newPath!);

        return result;
      } catch (error) {
        await tx.syncOperation.update({
          where: { id: syncOp.id },
          data: { status: 'failed' },
        });
        throw error;
      }
    });
  }

  private async processCreateUpdateOperation(
    data: FileOperationData,
    deviceDbId: string
  ): Promise<FileOperationResult> {
    const hash = this.storage.calculateHash(data.content);
    const contentSize = this.storage.calculateSize(data.content);
    
    // Validate file size
    if (contentSize > this.configService.maxFileSize) {
      throw SyncErrors.fileTooLarge(contentSize, this.configService.maxFileSize, data.filePath);
    }

    return await this.prisma.$transaction(async (tx) => {
      // Create sync operation record
      const syncOp = await tx.syncOperation.create({
        data: {
          vaultId: data.vaultId,
          deviceId: deviceDbId,
          operationType: data.operationType,
          filePath: data.filePath,
          previousHash: data.previousHash,
          newHash: hash,
          status: 'pending',
        },
      });

      try {
        const existingFile = await tx.file.findFirst({
          where: {
            vaultId: data.vaultId,
            path: data.filePath,
          },
        });

        let result: FileOperationResult;

        if (existingFile) {
          // Use conflict resolver for update operations
          const resolution = this.conflictResolver.resolveFileConflict({
            vaultId: data.vaultId,
            filePath: data.filePath,
            clientContent: data.content,
            clientHash: hash,
            clientTimestamp: data.clientTimestamp,
            previousHash: data.previousHash,
            existingFile: {
              id: existingFile.id,
              hash: existingFile.hash,
              version: existingFile.version,
              mtime: existingFile.mtime,
              size: existingFile.size,
            },
          });

          // Log conflict resolution
          this.conflictResolver.logConflictResolution(
            data.vaultId,
            data.filePath,
            data.operationType,
            resolution,
            data.deviceId
          );

          if (resolution.action === 'reject') {
            result = {
              success: false,
              version: existingFile.version,
              hash: existingFile.hash,
              currentVersion: resolution.currentVersion,
              currentHash: resolution.currentHash,
              conflictType: resolution.conflictType,
              clientMtime: resolution.clientMtime,
              serverMtime: resolution.serverMtime,
            };
          } else if (resolution.action === 'update_mtime_only') {
            const updatedFile = await tx.file.update({
              where: { id: existingFile.id },
              data: {
                mtime: data.clientTimestamp ? new Date(data.clientTimestamp) : new Date(),
                version: { increment: 1 },
              },
            });
            result = { success: true, version: updatedFile.version, hash, updated: resolution.updated };
          } else if (resolution.action === 'no_change') {
            result = { success: true, version: existingFile.version, hash, updated: resolution.updated };
          } else {
            // Accept update
            const updatedFile = await tx.file.update({
              where: { id: existingFile.id },
              data: {
                hash,
                size: contentSize,
                mtime: data.clientTimestamp ? new Date(data.clientTimestamp) : new Date(),
                version: { increment: 1 },
              },
            });
            result = { success: true, version: updatedFile.version, hash, updated: resolution.updated };
          }
        } else {
          // Create new file
          const newFile = await tx.file.create({
            data: {
              vaultId: data.vaultId,
              path: data.filePath,
              hash,
              size: contentSize,
              mtime: data.clientTimestamp ? new Date(data.clientTimestamp) : new Date(),
            },
          });
          result = { success: true, version: newFile.version, hash, updated: 'created' };
        }

        // Update sync operation status
        await tx.syncOperation.update({
          where: { id: syncOp.id },
          data: { status: result.success ? 'applied' : 'conflicted' },
        });

        // File operations after transaction (only if successful and content needs to be written)
        if (result.success && (result.updated === 'full' || result.updated === 'created')) {
          this.writeFileToStorage(data.vaultId, data.filePath, data.content);
        }

        return result;
      } catch (error) {
        await tx.syncOperation.update({
          where: { id: syncOp.id },
          data: { status: 'failed' },
        });
        throw error;
      }
    });
  }

  /**
   * Async file operations (fire-and-forget with error logging)
   */
  private writeFileToStorage(vaultId: string, filePath: string, content: string): void {
    this.storage.writeFile(vaultId, filePath, content).catch(error => {
      this.errorHandler.handleError(
        error,
        'SyncService',
        'write_file_storage',
        { vaultId, filePath }
      );
    });
  }

  private deleteFileFromStorage(vaultId: string, filePath: string): void {
    this.storage.deleteFile(vaultId, filePath).catch(error => {
      this.errorHandler.handleError(
        error,
        'SyncService',
        'delete_file_storage',
        { vaultId, filePath }
      );
    });
  }

  private renameFileInStorage(vaultId: string, oldPath: string, newPath: string): void {
    this.storage.renameFile(vaultId, oldPath, newPath).catch(error => {
      this.errorHandler.handleError(
        error,
        'SyncService',
        'rename_file_storage',
        { vaultId, oldPath, newPath }
      );
    });
  }
}
