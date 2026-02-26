import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VaultService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllVaults() {
    return await this.prisma.vault.findMany({
      include: {
        _count: {
          select: {
            devices: true,
            files: true,
          },
        },
      },
    });
  }

  async getVaultById(id: string) {
    return await this.prisma.vault.findUnique({
      where: { id },
      include: {
        devices: {
          select: {
            id: true,
            deviceName: true,
            deviceId: true,
            isOnline: true,
            lastSeen: true,
          },
        },
        _count: {
          select: {
            files: true,
            locks: true,
          },
        },
      },
    });
  }

  async getVaultDevices(vaultId: string) {
    return await this.prisma.device.findMany({
      where: { vaultId },
      orderBy: { lastSeen: 'desc' },
    });
  }

  async getVaultFiles(vaultId: string) {
    return await this.prisma.file.findMany({
      where: { vaultId },
      select: {
        id: true,
        path: true,
        size: true,
        hash: true,
        version: true,
        mtime: true,
        updatedAt: true,
      },
      orderBy: { path: 'asc' },
    });
  }

  async getActiveLocks(vaultId: string) {
    return await this.prisma.fileLock.findMany({
      where: {
        vaultId,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        file: {
          select: {
            path: true,
          },
        },
        device: {
          select: {
            deviceName: true,
            deviceId: true,
          },
        },
      },
    });
  }

  async createVault(name: string) {
    return await this.prisma.vault.create({
      data: { name },
    });
  }

  async deleteVault(id: string) {
    return await this.prisma.vault.delete({
      where: { id },
    });
  }

  async cleanupExpiredLocks(vaultId: string) {
    const result = await this.prisma.fileLock.deleteMany({
      where: {
        vaultId,
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    return { deletedLocks: result.count };
  }
}