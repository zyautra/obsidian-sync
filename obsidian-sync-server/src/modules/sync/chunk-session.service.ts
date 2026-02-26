import { Injectable } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';
import { StorageService } from '../storage/storage.service';
import { createHash } from 'crypto';
import * as path from 'path';
import { promises as fs } from 'fs';

export interface ChunkSession {
  filePath: string;
  fileHash: string;
  fileSize: number;
  totalChunks: number;
  receivedChunks: Map<number, Buffer>;
  chunkHashes: Map<number, string>;
  startTime: number;
  clientId: string;
  vaultId: string;
  lastActivity: number;
}

@Injectable()
export class ChunkSessionService {
  private chunkSessions: Map<string, ChunkSession> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly logger: LoggerService,
    private readonly storage: StorageService,
  ) {
    // Start cleanup timer - every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  /**
   * Create a new chunk upload session
   */
  createSession(
    sessionId: string,
    vaultId: string,
    filePath: string,
    fileHash: string,
    fileSize: number,
    totalChunks: number,
    clientId: string
  ): void {
    const session: ChunkSession = {
      filePath,
      fileHash,
      fileSize,
      totalChunks,
      receivedChunks: new Map(),
      chunkHashes: new Map(),
      startTime: Date.now(),
      lastActivity: Date.now(),
      clientId,
      vaultId,
    };

    this.chunkSessions.set(sessionId, session);

    this.logger.log('Chunk upload session created', 'ChunkSessionService', {
      sessionId,
      vaultId,
      filePath,
      fileSize,
      totalChunks,
      clientId,
    });
  }

  /**
   * Build deterministic session ID for a client/file pair
   */
  buildSessionId(vaultId: string, clientId: string, filePath: string): string {
    return `${vaultId}:${clientId}:${filePath}`;
  }

  /**
   * Store a chunk in the session
   */
  storeChunk(
    sessionId: string,
    chunkIndex: number,
    chunkData: Buffer,
    chunkHash: string
  ): { success: boolean; message?: string } {
    const session = this.chunkSessions.get(sessionId);
    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    // Verify chunk hash
    const calculatedHash = createHash('sha256').update(chunkData).digest('hex');
    if (calculatedHash !== chunkHash) {
      this.logger.warn('Chunk hash mismatch', 'ChunkSessionService', {
        sessionId,
        chunkIndex,
        expectedHash: chunkHash,
        calculatedHash,
      });
      return { success: false, message: 'Chunk hash mismatch' };
    }

    // Store chunk
    session.receivedChunks.set(chunkIndex, chunkData);
    session.chunkHashes.set(chunkIndex, chunkHash);
    session.lastActivity = Date.now();

    this.logger.debug('Chunk stored', 'ChunkSessionService', {
      sessionId,
      chunkIndex,
      chunkSize: chunkData.length,
      receivedCount: session.receivedChunks.size,
      totalChunks: session.totalChunks,
    });

    return { success: true };
  }

  /**
   * Check if all chunks are received and assemble the file
   */
  async completeUpload(sessionId: string): Promise<{
    success: boolean;
    message?: string;
    missingChunks?: number[];
    fileHash?: string;
    fileSize?: number;
  }> {
    const session = this.chunkSessions.get(sessionId);
    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    // Check if all chunks are received
    const missingChunks: number[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      if (!session.receivedChunks.has(i)) {
        missingChunks.push(i);
      }
    }

    if (missingChunks.length > 0) {
      return { success: false, message: 'Missing chunks', missingChunks };
    }

    try {
      // Assemble chunks into final file
      const chunks: Buffer[] = [];
      for (let i = 0; i < session.totalChunks; i++) {
        chunks.push(session.receivedChunks.get(i)!);
      }

      const finalBuffer = Buffer.concat(chunks);
      if (finalBuffer.length !== session.fileSize) {
        return {
          success: false,
          message: `File size mismatch: expected ${session.fileSize}, got ${finalBuffer.length}`,
        };
      }

      // Verify final file hash
      const calculatedHash = createHash('sha256').update(finalBuffer).digest('hex');
      if (calculatedHash !== session.fileHash) {
        this.logger.error('Final file hash mismatch', null, 'ChunkSessionService', {
          sessionId,
          expectedHash: session.fileHash,
          calculatedHash,
          fileSize: finalBuffer.length,
        });
        return { success: false, message: 'Final file hash verification failed' };
      }

      // Save binary content as base64 text for consistency with existing binary sync flow
      const finalContentBase64 = finalBuffer.toString('base64');
      await this.storage.writeFile(session.vaultId, session.filePath, finalContentBase64);

      this.logger.log('Chunk upload completed successfully', 'ChunkSessionService', {
        sessionId,
        vaultId: session.vaultId,
        filePath: session.filePath,
        finalSize: finalBuffer.length,
        totalChunks: session.totalChunks,
        duration: Date.now() - session.startTime,
      });

      // Clean up the session
      this.chunkSessions.delete(sessionId);

      return { success: true, fileHash: calculatedHash, fileSize: finalBuffer.length };
    } catch (error) {
      this.logger.error('Failed to complete chunk upload', error.stack, 'ChunkSessionService', {
        sessionId,
        error: error.message,
      });
      return { success: false, message: `Assembly failed: ${error.message}` };
    }
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): ChunkSession | undefined {
    return this.chunkSessions.get(sessionId);
  }

  /**
   * Cancel a session
   */
  cancelSession(sessionId: string): boolean {
    const session = this.chunkSessions.get(sessionId);
    if (session) {
      this.logger.log('Chunk upload session cancelled', 'ChunkSessionService', {
        sessionId,
        receivedChunks: session.receivedChunks.size,
        totalChunks: session.totalChunks,
      });
      this.chunkSessions.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Clean up expired sessions (older than 30 minutes)
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.chunkSessions.entries()) {
      // Sessions expire after 30 minutes of inactivity
      if (now - session.lastActivity > 30 * 60 * 1000) {
        expiredSessions.push(sessionId);
      }
    }

    if (expiredSessions.length > 0) {
      this.logger.warn('Cleaning up expired chunk sessions', 'ChunkSessionService', {
        expiredCount: expiredSessions.length,
        totalSessions: this.chunkSessions.size,
      });

      for (const sessionId of expiredSessions) {
        this.chunkSessions.delete(sessionId);
      }
    }
  }

  /**
   * Get session statistics
   */
  getStats() {
    const sessions = Array.from(this.chunkSessions.values());
    return {
      activeSessions: sessions.length,
      oldestSession: sessions.length > 0 ? Math.min(...sessions.map(s => s.startTime)) : null,
      totalMemoryUsage: sessions.reduce((total, session) => {
        return total + Array.from(session.receivedChunks.values())
          .reduce((sum, chunk) => sum + chunk.length, 0);
      }, 0),
    };
  }

  /**
   * Shutdown cleanup
   */
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
