import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { LoggerService } from '../logger/logger.service';
import { ErrorHandlerService } from '../../common/errors/error-handler.service';
import { SyncErrors } from '../../common/errors/sync-error.types';

export interface FileLockInfo {
  id: string;
  vaultId: string;
  fileId: string;
  deviceId: string;
  lockedAt: Date;
  expiresAt: Date;
  isExpired: boolean;
}

export interface LockResult {
  success: boolean;
  lock?: FileLockInfo;
  reason?: string;
  expiresAt?: Date;
}

@Injectable()
export class FileLockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  /**
   * Request a file lock for a specific device
   */
  async requestFileLock(vaultId: string, filePath: string, deviceId: string): Promise<LockResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Get device UUID from client deviceId
        const device = await tx.device.findUnique({
          where: { deviceId },
          select: { id: true, deviceName: true }
        });

        if (!device) {
          return {
            success: false,
            reason: 'Device not found',
          };
        }

        const file = await tx.file.findFirst({
          where: { vaultId, path: filePath },
        });

        if (!file) {
          return {
            success: false,
            reason: 'File not found',
          };
        }

        // Check for existing lock
        const existingLock = await tx.fileLock.findUnique({
          where: { fileId: file.id },
        });

        const now = new Date();
        const lockExpiration = this.configService.fileLockExpiration;

        // If lock exists and hasn't expired
        if (existingLock && existingLock.expiresAt > now) {
          // Check if the same device is requesting (allow renewal)
          if (existingLock.deviceId === device.id) {
            const renewedLock = await tx.fileLock.update({
              where: { id: existingLock.id },
              data: {
                expiresAt: new Date(Date.now() + lockExpiration),
                lockedAt: now,
              },
            });

            this.logger.debug('File lock renewed', 'FileLockService', {
              vaultId,
              filePath,
              deviceId,
              lockId: renewedLock.id,
              expiresAt: renewedLock.expiresAt,
            });

            return {
              success: true,
              lock: {
                id: renewedLock.id,
                vaultId: renewedLock.vaultId,
                fileId: renewedLock.fileId,
                deviceId: renewedLock.deviceId,
                lockedAt: renewedLock.lockedAt,
                expiresAt: renewedLock.expiresAt,
                isExpired: false,
              },
              expiresAt: renewedLock.expiresAt,
            };
          }

          // Lock is held by another device
          return {
            success: false,
            reason: 'File is locked by another device',
            expiresAt: existingLock.expiresAt,
          };
        }

        // Clean up expired lock if exists
        if (existingLock) {
          await tx.fileLock.delete({
            where: { id: existingLock.id },
          });
          
          this.logger.debug('Expired lock cleaned up', 'FileLockService', {
            vaultId,
            filePath,
            lockId: existingLock.id,
            expiredAt: existingLock.expiresAt,
          });
        }

        // Create new lock
        try {
          const newLock = await tx.fileLock.create({
            data: {
              vaultId,
              fileId: file.id,
              deviceId: device.id,
              lockedAt: now,
              expiresAt: new Date(Date.now() + lockExpiration),
            },
          });

          this.logger.debug('File lock acquired', 'FileLockService', {
            vaultId,
            filePath,
            deviceId,
            lockId: newLock.id,
            expiresAt: newLock.expiresAt,
          });

          return {
            success: true,
            lock: {
              id: newLock.id,
              vaultId: newLock.vaultId,
              fileId: newLock.fileId,
              deviceId: newLock.deviceId,
              lockedAt: newLock.lockedAt,
              expiresAt: newLock.expiresAt,
              isExpired: false,
            },
            expiresAt: newLock.expiresAt,
          };
        } catch (error) {
          // Handle unique constraint violation (concurrent lock attempts)
          if (error.code === 'P2002') {
            return {
              success: false,
              reason: 'Concurrent lock attempt detected',
            };
          }
          throw error;
        }
      });
    } catch (error) {
      const syncError = this.errorHandler.handleError(
        error,
        'FileLockService',
        'request_file_lock',
        { vaultId, filePath, deviceId }
      );
      throw syncError;
    }
  }

  /**
   * Release a specific file lock
   */
  async releaseFileLock(vaultId: string, filePath: string, deviceId?: string): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const file = await tx.file.findFirst({
          where: { vaultId, path: filePath },
        });

        if (!file) {
          return false;
        }

        const whereClause: any = { fileId: file.id };
        
        // If deviceId is provided, only release locks held by that device
        if (deviceId) {
          const device = await tx.device.findUnique({
            where: { deviceId },
            select: { id: true }
          });
          
          if (device) {
            whereClause.deviceId = device.id;
          }
        }

        const deletedLocks = await tx.fileLock.deleteMany({
          where: whereClause,
        });

        this.logger.debug('File locks released', 'FileLockService', {
          vaultId,
          filePath,
          deviceId,
          releasedCount: deletedLocks.count,
        });

        return deletedLocks.count > 0;
      });
    } catch (error) {
      const syncError = this.errorHandler.handleError(
        error,
        'FileLockService',
        'release_file_lock',
        { vaultId, filePath, deviceId }
      );
      throw syncError;
    }
  }

  /**
   * Release all locks held by a device
   */
  async releaseAllDeviceLocks(deviceId: string): Promise<number> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const device = await tx.device.findUnique({
          where: { deviceId },
          select: { id: true }
        });

        if (!device) {
          return 0;
        }

        const deletedLocks = await tx.fileLock.deleteMany({
          where: { deviceId: device.id },
        });

        this.logger.debug('All device locks released', 'FileLockService', {
          deviceId,
          releasedCount: deletedLocks.count,
        });

        return deletedLocks.count;
      });
    } catch (error) {
      const syncError = this.errorHandler.handleError(
        error,
        'FileLockService',
        'release_all_device_locks',
        { deviceId }
      );
      throw syncError;
    }
  }

  /**
   * Get all active locks for a vault
   */
  async getActiveLocks(vaultId: string): Promise<FileLockInfo[]> {
    try {
      const locks = await this.prisma.fileLock.findMany({
        where: {
          vaultId,
          expiresAt: { gt: new Date() },
        },
        include: {
          file: { select: { path: true } },
          device: { select: { deviceId: true, deviceName: true } },
        },
      });

      return locks.map(lock => ({
        id: lock.id,
        vaultId: lock.vaultId,
        fileId: lock.fileId,
        deviceId: lock.device.deviceId,
        lockedAt: lock.lockedAt,
        expiresAt: lock.expiresAt,
        isExpired: lock.expiresAt <= new Date(),
      }));
    } catch (error) {
      const syncError = this.errorHandler.handleError(
        error,
        'FileLockService',
        'get_active_locks',
        { vaultId }
      );
      throw syncError;
    }
  }

  /**
   * Check if a file is currently locked
   */
  async isFileLocked(vaultId: string, filePath: string): Promise<{ locked: boolean; lockInfo?: FileLockInfo }> {
    try {
      const file = await this.prisma.file.findFirst({
        where: { vaultId, path: filePath },
      });

      if (!file) {
        return { locked: false };
      }

      const lock = await this.prisma.fileLock.findUnique({
        where: { fileId: file.id },
        include: {
          device: { select: { deviceId: true, deviceName: true } },
        },
      });

      if (!lock || lock.expiresAt <= new Date()) {
        return { locked: false };
      }

      return {
        locked: true,
        lockInfo: {
          id: lock.id,
          vaultId: lock.vaultId,
          fileId: lock.fileId,
          deviceId: lock.device.deviceId,
          lockedAt: lock.lockedAt,
          expiresAt: lock.expiresAt,
          isExpired: false,
        },
      };
    } catch (error) {
      const syncError = this.errorHandler.handleError(
        error,
        'FileLockService',
        'is_file_locked',
        { vaultId, filePath }
      );
      throw syncError;
    }
  }

  /**
   * Clean up all expired locks
   */
  async cleanupExpiredLocks(): Promise<number> {
    try {
      const deletedLocks = await this.prisma.fileLock.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });

      if (deletedLocks.count > 0) {
        this.logger.debug('Expired locks cleaned up', 'FileLockService', {
          cleanedCount: deletedLocks.count,
        });
      }

      return deletedLocks.count;
    } catch (error) {
      const syncError = this.errorHandler.handleError(
        error,
        'FileLockService',
        'cleanup_expired_locks'
      );
      throw syncError;
    }
  }

  /**
   * Get lock statistics for monitoring
   */
  async getLockStats() {
    try {
      const [totalLocks, expiredLocks] = await Promise.all([
        this.prisma.fileLock.count(),
        this.prisma.fileLock.count({
          where: { expiresAt: { lt: new Date() } },
        }),
      ]);

      return {
        totalLocks,
        activeLocks: totalLocks - expiredLocks,
        expiredLocks,
        lockExpiration: this.configService.fileLockExpiration,
      };
    } catch (error) {
      const syncError = this.errorHandler.handleError(
        error,
        'FileLockService',
        'get_lock_stats'
      );
      throw syncError;
    }
  }
}