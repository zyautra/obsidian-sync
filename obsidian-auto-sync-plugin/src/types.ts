/**
 * Auto Sync Plugin    
 * 
 * WebSocket      .
 *   BaseMessage    .
 * 
 * @fileoverview    
 * @version 1.0.0
 */

/**
 *    
 */
export interface BaseMessage {
  /**   */
  type: string;
  /**    */
  vaultId: string;
  /**    */
  deviceId: string;
}

export interface RegisterDeviceMessage extends BaseMessage {
  type: 'register-device';
  deviceName: string;
}

export interface RegisterDeviceResponseMessage extends BaseMessage {
  type: 'register-device-response';
  success: boolean;
  message?: string;
}

/**
 *    
 *  ,    .
 */
export interface FileChangeMessage extends BaseMessage {
  type: 'file-change';
  /**    */
  filePath: string;
  /**   */
  content: string;
  /**   SHA256  */
  hash: string;
  /**   () */
  timestamp: number;
  /**      ( ) */
  previousHash?: string;
  /**   () */
  size?: number;
}

/**
 *    
 *     .
 */
export interface FileDeleteMessage extends BaseMessage {
  type: 'file-delete';
  /**    */
  filePath: string;
  /**   () */
  timestamp: number;
}

/**
 *    
 *      .
 */
export interface FileRenameMessage extends BaseMessage {
  type: 'file-rename';
  /**    */
  oldPath: string;
  /**    */
  newPath: string;
  /**   () */
  timestamp: number;
}

export interface FileLockRequest extends BaseMessage {
  type: 'request-lock';
  filePath: string;
}

export interface SyncRequest extends BaseMessage {
  type: 'request-sync';
  lastSyncTime?: number;
}

export interface LockAcquiredMessage extends BaseMessage {
  type: 'lock-acquired';
  filePath: string;
}

export interface LockDeniedMessage extends BaseMessage {
  type: 'lock-denied';
  filePath: string;
}

export interface ServerErrorMessage extends BaseMessage {
  type: 'error';
  message: string;
}

/**
 *    
 *        .
 */
export interface FileChangeResponseMessage extends BaseMessage {
  type: 'file-change-response';
  /**    */
  filePath: string;
  /**    */
  success: boolean;
  /**   ( ) */
  conflictType?: 'older_timestamp' | 'hash_mismatch' | 'concurrent_edit';
  /**    */
  clientMtime?: number;
  /**    */
  serverMtime?: number;
  /**    */
  serverHash?: string;
  /**    */
  message?: string;
}

/**
 *    
 *       .
 */
export interface ConflictResolutionMessage extends BaseMessage {
  type: 'resolve-conflict';
  /**    */
  filePath: string;
  /**   */
  resolution: 'overwrite' | 'merge' | 'keep_server' | 'keep_client';
  /**    (merge, overwrite ) */
  content?: string;
  /**    */
  hash?: string;
  /**   */
  timestamp: number;
}

/**
 *     
 *  (,  )    .
 */
export interface BinaryFileChangeMessage extends BaseMessage {
  type: 'binary-file-change';
  /**    */
  filePath: string;
  /** Base64    */
  content: string;
  /**   SHA256  */
  hash: string;
  /**   () */
  timestamp: number;
  /**    */
  isBinary: true;
  /**      ( ) */
  previousHash?: string;
  /**   () */
  size?: number;
}

/**
 *       
 *          .
 */
export interface ChunkUploadStartMessage extends BaseMessage {
  type: 'chunk-upload-start';
  /**    */
  filePath: string;
  /**   SHA256  */
  fileHash: string;
  /**    () */
  fileSize: number;
  /**   () */
  chunkSize: number;
  /**    */
  totalChunks: number;
  /**   () */
  timestamp: number;
  /**      ( ) */
  previousHash?: string;
}

/**
 *    
 *      .
 *      WebSocket  .
 */
export interface ChunkDataMessage extends BaseMessage {
  type: 'chunk-data';
  /**    */
  filePath: string;
  /**   (0 ) */
  chunkIndex: number;
  /**    () */
  chunkSize: number;
  /**   SHA256  */
  chunkHash: string;
  /**    () */
  fileHash: string;
}

/**
 *    
 *      .
 */
export interface ChunkUploadCompleteMessage extends BaseMessage {
  type: 'chunk-upload-complete';
  /**    */
  filePath: string;
  /**   SHA256  */
  fileHash: string;
  /**    () */
  fileSize: number;
  /**     */
  totalChunks: number;
}

/**
 *    
 *       .
 */
export interface ChunkUploadResponseMessage extends BaseMessage {
  type: 'chunk-upload-response';
  /**    */
  filePath: string;
  /**    */
  success: boolean;
  /**    (-1   ) */
  chunkIndex: number;
  /**   */
  message?: string;
  /**    ( ) */
  missingChunks?: number[];
}

/**
 *   
 *      .
 */
export interface FileInfo {
  /**   */
  path: string;
  /**   (  Base64 ) */
  content: string;
  /**   SHA256  */
  hash: string;
  /**    */
  isBinary?: boolean;
  /**   () */
  size?: number;
}

/**
 *   
 *     ,    .
 */
export interface SyncResponseMessage extends BaseMessage {
  type: 'sync-response';
  /**    */
  files: FileInfo[];
}

/**
 *     
 *  ,  ,   ,  ,  ,  ,  ,    .
 */
export type ClientMessage = 
  | RegisterDeviceMessage
  | FileChangeMessage
  | BinaryFileChangeMessage
  | FileDeleteMessage
  | FileLockRequest
  | SyncRequest
  | ConflictResolutionMessage
  | ChunkUploadStartMessage
  | ChunkDataMessage
  | ChunkUploadCompleteMessage;

/**
 *     
 *   ,   ,   ,  ,  ,  ,  ,    .
 */
export type ServerMessage = 
  | RegisterDeviceResponseMessage
  | FileChangeMessage
  | BinaryFileChangeMessage
  | FileDeleteMessage
  | FileRenameMessage
  | SyncResponseMessage
  | LockAcquiredMessage
  | LockDeniedMessage
  | ServerErrorMessage
  | FileChangeResponseMessage
  | ChunkUploadResponseMessage;

/**
 *    
 *      .
 */
export type AllMessage = ClientMessage | ServerMessage;
