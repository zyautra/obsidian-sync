import { App, Notice, TFile } from 'obsidian';
import { HashUtils } from '../utils/hash-utils';
import { ErrorUtils } from '../utils/error-utils';
import { 
  ChunkUploadStartMessage, 
  ChunkDataMessage, 
  ChunkUploadCompleteMessage 
} from '../types';

/**
 *     
 */
interface ChunkReceiveState {
  /**   */
  filePath: string;
  /**    */
  fileHash: string;
  /**    */
  totalSize: number;
  /**   */
  chunkSize: number;
  /**    */
  totalChunks: number;
  /**     ( → ArrayBuffer) */
  receivedChunks: Map<number, ArrayBuffer>;
  /**     () */
  chunkHashes: Map<number, string>;
  /**    */
  startTime: number;
  /**    */
  timeoutTimer?: NodeJS.Timeout;
}

/**
 *      
 * 
 *        .
 */
export class ChunkReceiver {
  /**   (30) */
  static readonly RECEIVE_TIMEOUT = 30 * 1000;
  
  /**     */
  private activeReceives: Map<string, ChunkReceiveState> = new Map();

  constructor(
    private app: App,
    private onProgress?: (filePath: string, progress: number) => void,
    private onComplete?: (filePath: string, success: boolean, error?: string) => void
  ) {}

  /**
   *     
   * 
   * @param message    
   * @returns   
   */
  startChunkReceive(message: ChunkUploadStartMessage): boolean {
    const { filePath, chunkSize, totalChunks } = message;
    const fileHash = (message as any).fileHash ?? (message as any).hash;
    const totalSize = (message as any).fileSize ?? (message as any).totalSize;
    
    try {
      //     
      if (this.activeReceives.has(filePath)) {
        console.warn(`File ${filePath} is already being received`);
        this.cancelReceive(filePath);
      }

      //   
      const receiveState: ChunkReceiveState = {
        filePath,
        fileHash,
        totalSize,
        chunkSize,
        totalChunks,
        receivedChunks: new Map(),
        chunkHashes: new Map(),
        startTime: Date.now()
      };

      //   
      receiveState.timeoutTimer = setTimeout(() => {
        this.handleReceiveTimeout(filePath);
      }, ChunkReceiver.RECEIVE_TIMEOUT);

      this.activeReceives.set(filePath, receiveState);
      return true;

    } catch (error) {
      ErrorUtils.logError('startChunkReceive', error, { filePath });
      this.onComplete?.(filePath, false, ErrorUtils.getErrorMessage(error));
      return false;
    }
  }

  /**
   *    
   * 
   * @param chunkMessage   
   * @param chunkData    
   * @returns   
   */
  receiveChunk(chunkMessage: ChunkDataMessage, chunkData: ArrayBuffer): boolean {
    const { filePath, chunkIndex, chunkSize, chunkHash, fileHash } = chunkMessage;
    const receiveState = this.activeReceives.get(filePath);
    
    if (!receiveState) {
      console.warn(`Received chunk for unknown file: ${filePath}`);
      return false;
    }

    try {
      //   
      if (receiveState.fileHash !== fileHash) {
        throw new Error(`File hash mismatch for ${filePath}`);
      }

      //    (     )
      if (chunkData.byteLength !== chunkSize) {
        throw new Error(`Chunk size mismatch for chunk ${chunkIndex}: expected ${chunkSize}, got ${chunkData.byteLength}`);
      }

      //  
      receiveState.receivedChunks.set(chunkIndex, chunkData);
      receiveState.chunkHashes.set(chunkIndex, chunkHash);

      //   
      const progress = (receiveState.receivedChunks.size / receiveState.totalChunks) * 100;
      this.onProgress?.(filePath, progress);

      //     
      if (receiveState.receivedChunks.size === receiveState.totalChunks) {
        this.assembleFile(filePath);
      }

      return true;

    } catch (error) {
      ErrorUtils.logError('receiveChunk', error, { filePath, chunkIndex });
      this.cancelReceive(filePath, ErrorUtils.getErrorMessage(error));
      return false;
    }
  }

  /**
   *     
   * 
   * @param message    
   */
  handleUploadComplete(message: ChunkUploadCompleteMessage): void {
    const { filePath, totalChunks } = message;
    const receiveState = this.activeReceives.get(filePath);
    
    if (!receiveState) {
      console.warn(`Received complete message for unknown file: ${filePath}`);
      return;
    }

    //    
    if (receiveState.receivedChunks.size !== totalChunks) {
      const missing = totalChunks - receiveState.receivedChunks.size;
      this.cancelReceive(filePath, `Missing ${missing} chunks`);
      return;
    }

    //   (   )
    if (receiveState.receivedChunks.size === receiveState.totalChunks) {
      this.assembleFile(filePath);
    }
  }

  /**
   *     
   */
  private async assembleFile(filePath: string): Promise<void> {
    const receiveState = this.activeReceives.get(filePath);
    if (!receiveState) return;

    try {
      //   
      const chunks: ArrayBuffer[] = [];
      let totalSize = 0;

      for (let i = 0; i < receiveState.totalChunks; i++) {
        const chunk = receiveState.receivedChunks.get(i);
        if (!chunk) {
          throw new Error(`Missing chunk ${i} for ${filePath}`);
        }
        chunks.push(chunk);
        totalSize += chunk.byteLength;
      }

      //  ArrayBuffer 
      const assembledBuffer = new ArrayBuffer(totalSize);
      const assembledView = new Uint8Array(assembledBuffer);
      let offset = 0;

      for (const chunk of chunks) {
        const chunkView = new Uint8Array(chunk);
        assembledView.set(chunkView, offset);
        offset += chunk.byteLength;
      }

      //    (     )
      if (totalSize !== receiveState.totalSize) {
        throw new Error(`Assembled file size mismatch: expected ${receiveState.totalSize}, got ${totalSize}`);
      }

      //  
      await this.saveFile(filePath, assembledBuffer);
      
      //   
      this.completeReceive(filePath, true);

    } catch (error) {
      ErrorUtils.logError('assembleFile', error, { filePath });
      this.cancelReceive(filePath, ErrorUtils.getErrorMessage(error));
    }
  }

  /**
   *    
   */
  private async saveFile(filePath: string, data: ArrayBuffer): Promise<void> {
    try {
      //     
      await this.ensureDirectoryExists(filePath);

      //   
      const existingFile = this.app.vault.getAbstractFileByPath(filePath);
      
      if (existingFile instanceof TFile) {
        //   
        await this.app.vault.modifyBinary(existingFile, data);
      } else {
        //   
        await this.app.vault.createBinary(filePath, data);
      }

    } catch (error) {
      ErrorUtils.logError('saveFile', error, { filePath });
      throw error;
    }
  }

  /**
   *     
   */
  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const pathParts = filePath.split('/');
    pathParts.pop(); //  
    
    if (pathParts.length === 0) return;
    
    let currentPath = '';
    for (const part of pathParts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      try {
        const folder = this.app.vault.getAbstractFileByPath(currentPath);
        if (!folder) {
          await this.app.vault.createFolder(currentPath);
        }
      } catch (error) {
        //     
        const errorMessage = ErrorUtils.getErrorMessage(error);
        if (!errorMessage.includes('already exists') && !errorMessage.includes('EEXIST')) {
          ErrorUtils.logError('ensureDirectoryExists', error, { currentPath });
        }
      }
    }
  }

  /**
   *   
   */
  private handleReceiveTimeout(filePath: string): void {
    this.cancelReceive(filePath, 'Receive timeout');
  }

  /**
   *  
   */
  private cancelReceive(filePath: string, error?: string): void {
    this.completeReceive(filePath, false, error);
  }

  /**
   *   
   */
  private completeReceive(filePath: string, success: boolean, error?: string): void {
    const receiveState = this.activeReceives.get(filePath);
    if (!receiveState) return;

    //  
    if (receiveState.timeoutTimer) {
      clearTimeout(receiveState.timeoutTimer);
    }

    //   
    this.activeReceives.delete(filePath);

    //   
    this.onComplete?.(filePath, success, error);
  }

  /**
   *    
   */
  getMissingChunks(filePath: string): number[] {
    const receiveState = this.activeReceives.get(filePath);
    if (!receiveState) return [];

    const missing: number[] = [];
    for (let i = 0; i < receiveState.totalChunks; i++) {
      if (!receiveState.receivedChunks.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  /**
   *   
   */
  getReceiveStats(): {
    activeReceives: number;
    totalFiles: string[];
  } {
    return {
      activeReceives: this.activeReceives.size,
      totalFiles: Array.from(this.activeReceives.keys())
    };
  }

  /**
   *   
   */
  dispose(): void {
    //   
    for (const receiveState of this.activeReceives.values()) {
      if (receiveState.timeoutTimer) {
        clearTimeout(receiveState.timeoutTimer);
      }
    }
    
    //   
    this.activeReceives.clear();
  }
}
