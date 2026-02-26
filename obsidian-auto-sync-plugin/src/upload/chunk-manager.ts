import { TFile } from 'obsidian';
import { HashUtils } from '../utils/hash-utils';
import { ErrorUtils } from '../utils/error-utils';
import { 
  ChunkUploadStartMessage, 
  ChunkDataMessage, 
  ChunkUploadCompleteMessage,
  ChunkUploadResponseMessage 
} from '../types';

/**
 *   
 */
interface ChunkUploadState {
  /**   */
  filePath: string;
  /**    */
  fileData: ArrayBuffer;
  /**    */
  fileHash: string;
  /**    */
  totalChunks: number;
  /**     */
  sentChunks: Set<number>;
  /**     */
  confirmedChunks: Set<number>;
  /**   */
  chunkSize: number;
  /**    */
  startTime: number;
  /**   */
  retryCount: number;
}

/**
 *     
 * 
 *       ,
 *       .
 */
export class ChunkManager {
  /**   (25MB) */
  static readonly CHUNK_SIZE = 25 * 1024 * 1024; // 25MB
  
  /**    */
  static readonly MAX_RETRIES = 3;
  
  /**    () */
  static readonly CHUNK_INTERVAL = 100; // 100ms
  
  /**     */
  private activeUploads: Map<string, ChunkUploadState> = new Map();
  
  /**     */
  private chunkTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private sendMessage: (message: any) => boolean,
    private sendBinary: (data: ArrayBuffer) => boolean,
    private getVaultId: () => string,
    private getDeviceId: () => string,
    private onProgress?: (filePath: string, progress: number) => void,
    private onComplete?: (filePath: string, success: boolean, error?: string) => void
  ) {}

  /**
   *     
   * 
   * @param file  
   * @param previousHash    ( )
   * @returns    
   */
  async startChunkUpload(file: TFile, previousHash?: string): Promise<boolean> {
    const filePath = file.path;
    
    try {
      //     
      if (this.activeUploads.has(filePath)) {
        console.warn(`File ${filePath} is already being uploaded`);
        return false;
      }

      //   
      const fileData = await file.vault.readBinary(file);
      if (fileData.byteLength === 0) {
        throw new Error('Empty file cannot be uploaded');
      }

      //    (   ,  )
      const fileHash = HashUtils.generateBinaryHash(fileData);
      
      //   
      const totalChunks = Math.ceil(fileData.byteLength / ChunkManager.CHUNK_SIZE);
      
      //   
      const uploadState: ChunkUploadState = {
        filePath,
        fileData,
        fileHash,
        totalChunks,
        sentChunks: new Set(),
        confirmedChunks: new Set(),
        chunkSize: ChunkManager.CHUNK_SIZE,
        startTime: Date.now(),
        retryCount: 0
      };
      
      this.activeUploads.set(filePath, uploadState);

      //    
      const startMessage: ChunkUploadStartMessage = {
        type: 'chunk-upload-start',
        vaultId: this.getVaultId(),
        deviceId: this.getDeviceId(),
        filePath,
        fileHash,
        fileSize: fileData.byteLength,
        chunkSize: ChunkManager.CHUNK_SIZE,
        totalChunks,
        timestamp: file.stat.mtime,
        previousHash
      };

      const sent = this.sendMessage(startMessage);
      if (!sent) {
        this.activeUploads.delete(filePath);
        throw new Error('Failed to send upload start message');
      }

      //     
      this.scheduleChunkUpload(filePath, 0);
      
      return true;

    } catch (error) {
      ErrorUtils.logError('startChunkUpload', error, { filePath });
      this.activeUploads.delete(filePath);
      this.onComplete?.(filePath, false, ErrorUtils.getErrorMessage(error));
      return false;
    }
  }

  /**
   *    
   * 
   * @param response   
   */
  handleChunkResponse(response: ChunkUploadResponseMessage): void {
    const { filePath, success, chunkIndex, missingChunks } = response;
    const uploadState = this.activeUploads.get(filePath);
    
    if (!uploadState) {
      console.warn(`Received response for unknown upload: ${filePath}`);
      return;
    }

    try {
      if (success) {
        if (chunkIndex === -1) {
          //   
          this.completeUpload(filePath, true);
        } else {
          //   
          uploadState.confirmedChunks.add(chunkIndex);
          
          //   
          const progress = (uploadState.confirmedChunks.size / uploadState.totalChunks) * 100;
          this.onProgress?.(filePath, progress);
          
          //   
          this.scheduleNextChunk(filePath);
        }
      } else {
        //   
        if (missingChunks && missingChunks.length > 0) {
          //   
          this.retryChunks(filePath, missingChunks);
        } else {
          //  
          this.handleUploadFailure(filePath, response.message || 'Upload failed');
        }
      }
    } catch (error) {
      ErrorUtils.logError('handleChunkResponse', error, { filePath, chunkIndex });
      this.handleUploadFailure(filePath, ErrorUtils.getErrorMessage(error));
    }
  }

  /**
   *    
   */
  private scheduleChunkUpload(filePath: string, chunkIndex: number): void {
    const timer = setTimeout(() => {
      this.sendChunk(filePath, chunkIndex);
    }, ChunkManager.CHUNK_INTERVAL);
    
    this.chunkTimers.set(`${filePath}:${chunkIndex}`, timer);
  }

  /**
   *   
   */
  private async sendChunk(filePath: string, chunkIndex: number): Promise<void> {
    const uploadState = this.activeUploads.get(filePath);
    if (!uploadState) return;

    try {
      //   
      const start = chunkIndex * uploadState.chunkSize;
      const end = Math.min(start + uploadState.chunkSize, uploadState.fileData.byteLength);
      const chunkData = uploadState.fileData.slice(start, end);
      
      //    (   )
      const chunkHash = `chunk_${chunkIndex}_${chunkData.byteLength}`;
      
      //    
      const chunkMessage: ChunkDataMessage = {
        type: 'chunk-data',
        vaultId: this.getVaultId(),
        deviceId: this.getDeviceId(),
        filePath,
        chunkIndex,
        chunkSize: chunkData.byteLength,
        chunkHash,
        fileHash: uploadState.fileHash
      };

      //   
      const metaSent = this.sendMessage(chunkMessage);
      if (!metaSent) {
        throw new Error(`Failed to send chunk metadata for chunk ${chunkIndex}`);
      }

      //   
      const dataSent = this.sendBinary(chunkData);
      if (!dataSent) {
        throw new Error(`Failed to send chunk data for chunk ${chunkIndex}`);
      }

      uploadState.sentChunks.add(chunkIndex);
      
      console.log(`Sent chunk ${chunkIndex + 1}/${uploadState.totalChunks} for ${filePath}`);

    } catch (error) {
      ErrorUtils.logError('sendChunk', error, { filePath, chunkIndex });
      this.handleUploadFailure(filePath, ErrorUtils.getErrorMessage(error));
    }
  }

  /**
   *    
   */
  private scheduleNextChunk(filePath: string): void {
    const uploadState = this.activeUploads.get(filePath);
    if (!uploadState) return;

    //    
    if (uploadState.confirmedChunks.size === uploadState.totalChunks) {
      //    
      this.sendUploadComplete(filePath);
      return;
    }

    //    
    for (let i = 0; i < uploadState.totalChunks; i++) {
      if (!uploadState.sentChunks.has(i)) {
        this.scheduleChunkUpload(filePath, i);
        return;
      }
    }
  }

  /**
   *    
   */
  private sendUploadComplete(filePath: string): void {
    const uploadState = this.activeUploads.get(filePath);
    if (!uploadState) return;

    const completeMessage: ChunkUploadCompleteMessage = {
      type: 'chunk-upload-complete',
      vaultId: this.getVaultId(),
      deviceId: this.getDeviceId(),
      filePath,
      fileHash: uploadState.fileHash,
      fileSize: uploadState.fileData.byteLength,
      totalChunks: uploadState.totalChunks
    };

    this.sendMessage(completeMessage);
  }

  /**
   *   
   */
  private retryChunks(filePath: string, missingChunks: number[]): void {
    const uploadState = this.activeUploads.get(filePath);
    if (!uploadState) return;

    if (uploadState.retryCount >= ChunkManager.MAX_RETRIES) {
      this.handleUploadFailure(filePath, 'Maximum retry count exceeded');
      return;
    }

    uploadState.retryCount++;
    
    //   sent   
    for (const chunkIndex of missingChunks) {
      uploadState.sentChunks.delete(chunkIndex);
      uploadState.confirmedChunks.delete(chunkIndex);
      this.scheduleChunkUpload(filePath, chunkIndex);
    }
  }

  /**
   *   
   */
  private completeUpload(filePath: string, success: boolean, error?: string): void {
    //  
    this.clearTimers(filePath);
    
    //   
    this.activeUploads.delete(filePath);
    
    //   
    this.onComplete?.(filePath, success, error);
    
    const status = success ? 'completed' : 'failed';
    console.log(`Chunk upload ${status} for ${filePath}${error ? ': ' + error : ''}`);
  }

  /**
   *   
   */
  private handleUploadFailure(filePath: string, error: string): void {
    this.completeUpload(filePath, false, error);
  }

  /**
   *    
   */
  private clearTimers(filePath: string): void {
    for (const [key, timer] of this.chunkTimers.entries()) {
      if (key.startsWith(filePath + ':')) {
        clearTimeout(timer);
        this.chunkTimers.delete(key);
      }
    }
  }

  /**
   *  
   */
  cancelUpload(filePath: string): void {
    this.clearTimers(filePath);
    this.activeUploads.delete(filePath);
    console.log(`Upload cancelled for ${filePath}`);
  }

  /**
   *   
   */
  getUploadStats(): {
    activeUploads: number;
    totalFiles: string[];
  } {
    return {
      activeUploads: this.activeUploads.size,
      totalFiles: Array.from(this.activeUploads.keys())
    };
  }

  /**
   *   
   */
  dispose(): void {
    //   
    for (const timer of this.chunkTimers.values()) {
      clearTimeout(timer);
    }
    this.chunkTimers.clear();
    
    //   
    this.activeUploads.clear();
  }
}
