import { TFile, App, Notice } from 'obsidian';
import { FileUtils } from '../utils/file-utils';
import { HashUtils } from '../utils/hash-utils';
import { ErrorUtils } from '../utils/error-utils';
import { MessageFactory } from '../message/message-factory';
import { ChunkManager } from '../upload/chunk-manager';
import { ChunkUploadResponseMessage } from '../types';

/**
 *   
 * 
 *     .
 * ,  ,   .
 */
export class SyncManager {
  /**     */
  private pendingSyncs: Map<string, NodeJS.Timeout> = new Map();
  /**      */
  private lastKnownHashes: Map<string, string> = new Map();
  /**     (  ) */
  private filesInTransit: Set<string> = new Set();
  /**     */
  private batchQueue: Map<string, { file: TFile; timestamp: number }> = new Map();
  /**    */
  private batchTimer: NodeJS.Timeout | null = null;
  /**    */
  private readonly BATCH_SIZE = 10;
  /**    */
  private readonly BATCH_INTERVAL = 2000; // 2
  /**
   * (base64 JSON)    .
   * 30MB WebSocket payload  base64    10MB .
   */
  private static readonly INLINE_BINARY_MAX_SIZE = 10 * 1024 * 1024; // 10MB

  /**    */
  private chunkManager: ChunkManager;

  constructor(
    private app: App,
    private syncInterval: number,
    private sendMessage: (message: any) => boolean,
    private sendBinary: (data: ArrayBuffer) => boolean,
    private getVaultId: () => string,
    private getDeviceId: () => string
  ) {
    //   
    this.chunkManager = new ChunkManager(
      this.sendMessage,
      this.sendBinary,
      this.getVaultId,
      this.getDeviceId,
      (filePath, progress) => this.onChunkProgress(filePath, progress),
      (filePath, success, error) => this.onChunkComplete(filePath, success, error)
    );
  }

  /**
   *    ( )
   * 
   * @param file  
   */
  scheduleSync(file: TFile): void {
    const filePath = file.path;
    
    //   
    if (FileUtils.shouldIgnoreFile(filePath)) {
      return;
    }
    
    //    
    if (this.pendingSyncs.has(filePath)) {
      clearTimeout(this.pendingSyncs.get(filePath)!);
    }

    //     
    const debounceDelay = FileUtils.calculateOptimalDebounceDelay(
      filePath, 
      file.stat.size, 
      this.syncInterval
    );

    const timeout = setTimeout(async () => {
      try {
        await this.syncFile(file);
      } catch (error) {
        ErrorUtils.logError('scheduleSync', error, { filePath });
        const userMessage = ErrorUtils.getUserFriendlyMessage(error, 'File sync');
        new Notice(`❌ ${userMessage}`);
      } finally {
        this.pendingSyncs.delete(filePath);
      }
    }, debounceDelay);

    this.pendingSyncs.set(filePath, timeout);
  }

  /**
   *    
   * 
   * @param file   
   */
  addToBatch(file: TFile): void {
    if (FileUtils.shouldIgnoreFile(file.path)) {
      return;
    }

    this.batchQueue.set(file.path, {
      file,
      timestamp: Date.now()
    });

    //        
    if (this.batchQueue.size >= this.BATCH_SIZE) {
      this.processBatch();
    } else if (!this.batchTimer) {
      //   
      this.batchTimer = setTimeout(() => {
        this.processBatch();
      }, this.BATCH_INTERVAL);
    }
  }

  /**
   *       
   * 
   * @param file   
   */
  addToBatchAndProcess(file: TFile): void {
    if (FileUtils.shouldIgnoreFile(file.path)) {
      return;
    }

    this.batchQueue.set(file.path, {
      file,
      timestamp: Date.now()
    });
  }

  /**
   *    
   */
  async processBatchImmediate(): Promise<void> {
    await this.processBatch();
  }

  /**
   *   
   */
  private async processBatch(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.batchQueue.size === 0) {
      return;
    }

    const batch = Array.from(this.batchQueue.values());
    this.batchQueue.clear();

    //    (,   )
    const concurrentLimit = 3;
    for (let i = 0; i < batch.length; i += concurrentLimit) {
      const chunk = batch.slice(i, i + concurrentLimit);
      
      await Promise.allSettled(
        chunk.map(({ file }) => this.syncFile(file))
      );

      //      
      if (i + concurrentLimit < batch.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    new Notice(`Batch sync completed for ${batch.length} files`);
  }

  /**
   *    
   * 
   * @param file  
   */
  private async syncFile(file: TFile): Promise<void> {
    const filePath = file.path;
    
    //   
    if (this.filesInTransit.has(filePath)) {
      console.log(`File ${filePath} is already in transit, skipping`);
      return;
    }

    try {
      this.filesInTransit.add(filePath);
      
      const vaultId = this.getVaultId();
      const deviceId = this.getDeviceId();
      
      if (FileUtils.isTextFile(file.path)) {
        //   
        const content = await this.app.vault.read(file);
        const hash = HashUtils.generateFileHash(content);
        const previousHash = this.lastKnownHashes.get(file.path);
        
        //    
        if (previousHash === hash) {
          console.log(`File ${filePath} content unchanged, skipping sync`);
          return;
        }
        
        const message = MessageFactory.createFileChangeMessage({
          vaultId,
          deviceId,
          filePath: file.path,
          content,
          hash,
          timestamp: file.stat.mtime,
          previousHash
        });
        
        this.sendMessage(message);
        this.lastKnownHashes.set(file.path, hash);
      } else {
        //    -   
        const fileSize = file.stat.size;
        
        //   10MB  ,   
        if (fileSize <= SyncManager.INLINE_BINARY_MAX_SIZE) {
          await this.syncSmallBinaryFile(file);
        } else {
          await this.syncLargeBinaryFile(file);
        }
      }
    } catch (error) {
      ErrorUtils.logError('syncFile', error, { filePath: file.path });
      throw error;
    } finally {
      //    transit  
      this.filesInTransit.delete(filePath);
    }
  }

  /**
   *     ( )
   */
  private async syncSmallBinaryFile(file: TFile): Promise<void> {
    const vaultId = this.getVaultId();
    const deviceId = this.getDeviceId();
    const previousHash = this.lastKnownHashes.get(file.path);
    
    const arrayBuffer = await this.app.vault.readBinary(file);
    const base64Content = HashUtils.arrayBufferToBase64(arrayBuffer);
    
    //        ( )
    const hash = HashUtils.generateBinaryHash(arrayBuffer);
    
    const message = MessageFactory.createBinaryFileChangeMessage({
      vaultId,
      deviceId,
      filePath: file.path,
      content: base64Content,
      hash,
      timestamp: file.stat.mtime,
      previousHash
    });
    
    this.sendMessage(message);
    this.lastKnownHashes.set(file.path, hash);
  }

  /**
   *     
   */
  private async syncLargeBinaryFile(file: TFile): Promise<void> {
    const previousHash = this.lastKnownHashes.get(file.path);
    
    const success = await this.chunkManager.startChunkUpload(file, previousHash);
    if (!success) {
      throw new Error(`Failed to start chunk upload for ${file.path}`);
    }
  }

  /**
   *   
   * 
   * @param filePath   
   */
  syncFileDelete(filePath: string): void {
    const message = MessageFactory.createFileDeleteMessage({
      vaultId: this.getVaultId(),
      deviceId: this.getDeviceId(),
      filePath
    });
    
    this.sendMessage(message);
    this.lastKnownHashes.delete(filePath);
  }

  /**
   *    
   * 
   * @param oldPath   
   * @param newPath   
   */
  syncFileRename(oldPath: string, newPath: string): void {
    const message = MessageFactory.createFileRenameMessage({
      vaultId: this.getVaultId(),
      deviceId: this.getDeviceId(),
      oldPath,
      newPath
    });
    
    this.sendMessage(message);
    
    //    ( )
    const oldHash = this.lastKnownHashes.get(oldPath);
    if (oldHash) {
      this.lastKnownHashes.delete(oldPath);
      this.lastKnownHashes.set(newPath, oldHash);
    }
  }

  /**
   *   
   * 
   * @param filePath  
   * @param hash  
   */
  updateServerHash(filePath: string, hash: string): void {
    this.lastKnownHashes.set(filePath, hash);
  }

  /**
   *    
   * 
   * @param filePath  
   * @returns    undefined
   */
  getKnownHash(filePath: string): string | undefined {
    return this.lastKnownHashes.get(filePath);
  }

  /**
   *   
   * 
   * @returns    
   */
  getSyncStats(): {
    pendingCount: number;
    batchCount: number;
    knownFilesCount: number;
  } {
    return {
      pendingCount: this.pendingSyncs.size,
      batchCount: this.batchQueue.size,
      knownFilesCount: this.lastKnownHashes.size
    };
  }

  /**
   *  
   *     .
   */
  cleanup(): void {
    //     (5   )
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    
    for (const [path, { timestamp }] of this.batchQueue.entries()) {
      if (timestamp < fiveMinutesAgo) {
        this.batchQueue.delete(path);
      }
    }

    //     ( 1000)
    if (this.lastKnownHashes.size > 1000) {
      const entries = Array.from(this.lastKnownHashes.entries());
      //    (  200 )
      for (let i = 0; i < 200; i++) {
        this.lastKnownHashes.delete(entries[i][0]);
      }
    }
  }

  /**
   *    
   * 
   * @param response     
   */
  handleChunkUploadResponse(response: ChunkUploadResponseMessage): void {
    this.chunkManager.handleChunkResponse(response);
  }

  /**
   *     
   */
  private onChunkProgress(filePath: string, progress: number): void {
    //    ()
    if (progress % 20 === 0) { // 20% 
      new Notice(`${filePath}: upload ${progress.toFixed(1)}% complete...`);
    }
  }

  /**
   *    
   */
  private onChunkComplete(filePath: string, success: boolean, error?: string): void {
    if (success) {
      new Notice(`✅ Large file upload completed: ${filePath}`);
      
      //        
      // this.lastKnownHashes.set(filePath, hash);
    } else {
      new Notice(`❌ File upload failed: ${filePath}${error ? ' - ' + error : ''}`);
      ErrorUtils.logError('chunkUpload', error || 'Unknown error', { filePath });
    }
  }

  /**
   *   
   *    .
   */
  dispose(): void {
    //     
    for (const timeout of this.pendingSyncs.values()) {
      clearTimeout(timeout);
    }
    this.pendingSyncs.clear();

    //   
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    //   
    this.chunkManager.dispose();

    //  
    this.batchQueue.clear();
    this.lastKnownHashes.clear();
  }
}
