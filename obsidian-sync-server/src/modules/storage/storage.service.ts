import { Injectable, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { ConfigService } from '../config/config.service';

@Injectable()
export class StorageService implements OnModuleInit {
  private storagePath: string;
  private static readonly VAULT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.storagePath = this.configService.storagePath;
    await this.ensureDirectoryExists(this.storagePath);
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch (error) {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  private validateVaultId(vaultId: string): void {
    if (!StorageService.VAULT_ID_PATTERN.test(vaultId)) {
      throw new Error(`Invalid vaultId: ${vaultId}`);
    }
  }

  private validateFilePath(filePath: string): string {
    if (!filePath || filePath.includes('\0')) {
      throw new Error('Invalid filePath');
    }

    const normalized = filePath.replace(/\\/g, '/');
    if (path.isAbsolute(normalized)) {
      throw new Error('Absolute filePath is not allowed');
    }

    const segments = normalized.split('/');
    if (segments.some((segment) => segment === '..' || segment.length === 0)) {
      throw new Error('Path traversal detected');
    }

    return normalized;
  }

  private getVaultStoragePath(vaultId: string): string {
    this.validateVaultId(vaultId);

    const rootPath = path.resolve(this.storagePath);
    const vaultPath = path.resolve(rootPath, vaultId);
    if (!(vaultPath === rootPath || vaultPath.startsWith(rootPath + path.sep))) {
      throw new Error('Vault path is outside storage root');
    }

    return vaultPath;
  }

  private getFileStoragePath(vaultId: string, filePath: string): string {
    const vaultPath = this.getVaultStoragePath(vaultId);
    const safeFilePath = this.validateFilePath(filePath);
    const fullPath = path.resolve(vaultPath, safeFilePath);

    if (!(fullPath === vaultPath || fullPath.startsWith(vaultPath + path.sep))) {
      throw new Error('Resolved file path is outside vault directory');
    }

    return fullPath;
  }

  async ensureVaultDirectory(vaultId: string): Promise<void> {
    const vaultPath = this.getVaultStoragePath(vaultId);
    await this.ensureDirectoryExists(vaultPath);
  }

  async writeFile(vaultId: string, filePath: string, content: string): Promise<void> {
    // Validate file size before writing
    const contentSize = this.calculateSize(content);
    if (contentSize > this.configService.maxFileSize) {
      throw new Error(
        `File size ${contentSize} bytes exceeds maximum limit of ${this.configService.maxFileSize} bytes`
      );
    }
    
    const fullPath = this.getFileStoragePath(vaultId, filePath);
    const dir = path.dirname(fullPath);
    
    // Ensure directory structure exists
    await this.ensureDirectoryExists(dir);
    
    // Write file
    await fs.writeFile(fullPath, content, 'utf8');
  }

  async readFile(vaultId: string, filePath: string): Promise<string> {
    const fullPath = this.getFileStoragePath(vaultId, filePath);
    return await fs.readFile(fullPath, 'utf8');
  }

  async deleteFile(vaultId: string, filePath: string): Promise<void> {
    const fullPath = this.getFileStoragePath(vaultId, filePath);
    try {
      await fs.unlink(fullPath);
    } catch (error) {
      // File might not exist, which is fine for delete operations
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async renameFile(vaultId: string, oldPath: string, newPath: string): Promise<void> {
    const oldFullPath = this.getFileStoragePath(vaultId, oldPath);
    const newFullPath = this.getFileStoragePath(vaultId, newPath);
    
    // Ensure new directory structure exists
    const newDir = path.dirname(newFullPath);
    await this.ensureDirectoryExists(newDir);
    
    // Move file
    await fs.rename(oldFullPath, newFullPath);
  }

  async fileExists(vaultId: string, filePath: string): Promise<boolean> {
    const fullPath = this.getFileStoragePath(vaultId, filePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async getFileStats(vaultId: string, filePath: string): Promise<{ size: number; mtime: Date }> {
    const fullPath = this.getFileStoragePath(vaultId, filePath);
    const stats = await fs.stat(fullPath);
    return {
      size: stats.size,
      mtime: stats.mtime
    };
  }

  calculateHash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  calculateSize(content: string): number {
    return Buffer.byteLength(content, 'utf8');
  }
}
