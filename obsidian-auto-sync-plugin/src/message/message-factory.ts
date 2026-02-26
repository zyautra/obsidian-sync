import { 
  FileChangeMessage, 
  BinaryFileChangeMessage, 
  FileDeleteMessage,
  FileRenameMessage,
  SyncRequest, 
  RegisterDeviceMessage,
  ConflictResolutionMessage 
} from '../types';

/**
 *   
 * 
 *       
 *   .
 */
export class MessageFactory {
  /**
   *    
   * 
   * @param params    
   * @returns   
   */
  static createFileChangeMessage(params: {
    vaultId: string;
    deviceId: string;
    filePath: string;
    content: string;
    hash: string;
    timestamp?: number;
    previousHash?: string;
  }): FileChangeMessage {
    return {
      type: 'file-change',
      vaultId: params.vaultId,
      deviceId: params.deviceId,
      filePath: params.filePath,
      content: params.content,
      hash: params.hash,
      timestamp: params.timestamp ?? Date.now(),
      previousHash: params.previousHash
    };
  }

  /**
   *     
   * 
   * @param params    
   * @returns    
   */
  static createBinaryFileChangeMessage(params: {
    vaultId: string;
    deviceId: string;
    filePath: string;
    content: string;
    hash: string;
    timestamp?: number;
    previousHash?: string;
  }): BinaryFileChangeMessage {
    return {
      type: 'binary-file-change',
      vaultId: params.vaultId,
      deviceId: params.deviceId,
      filePath: params.filePath,
      content: params.content,
      hash: params.hash,
      timestamp: params.timestamp ?? Date.now(),
      isBinary: true,
      previousHash: params.previousHash
    };
  }

  /**
   *    
   * 
   * @param params    
   * @returns   
   */
  static createFileDeleteMessage(params: {
    vaultId: string;
    deviceId: string;
    filePath: string;
    timestamp?: number;
  }): FileDeleteMessage {
    return {
      type: 'file-delete',
      vaultId: params.vaultId,
      deviceId: params.deviceId,
      filePath: params.filePath,
      timestamp: params.timestamp ?? Date.now()
    };
  }

  /**
   *     
   * 
   * @param params    
   * @returns    
   */
  static createFileRenameMessage(params: {
    vaultId: string;
    deviceId: string;
    oldPath: string;
    newPath: string;
    timestamp?: number;
  }): FileRenameMessage {
    return {
      type: 'file-rename',
      vaultId: params.vaultId,
      deviceId: params.deviceId,
      oldPath: params.oldPath,
      newPath: params.newPath,
      timestamp: params.timestamp ?? Date.now()
    };
  }

  /**
   *    
   * 
   * @param params    
   * @returns   
   */
  static createSyncRequestMessage(params: {
    vaultId: string;
    deviceId: string;
    lastSyncTime?: number;
  }): SyncRequest {
    return {
      type: 'request-sync',
      vaultId: params.vaultId,
      deviceId: params.deviceId,
      lastSyncTime: params.lastSyncTime
    };
  }

  /**
   *    
   * 
   * @param params    
   * @returns   
   */
  static createRegisterDeviceMessage(params: {
    vaultId: string;
    deviceId: string;
    deviceName: string;
  }): RegisterDeviceMessage {
    return {
      type: 'register-device',
      vaultId: params.vaultId,
      deviceId: params.deviceId,
      deviceName: params.deviceName
    };
  }

  /**
   *    
   * 
   * @param params    
   * @returns   
   */
  static createConflictResolutionMessage(params: {
    vaultId: string;
    deviceId: string;
    filePath: string;
    resolution: 'overwrite' | 'merge' | 'keep_server' | 'keep_client';
    content?: string;
    hash?: string;
    timestamp?: number;
  }): ConflictResolutionMessage {
    return {
      type: 'resolve-conflict',
      vaultId: params.vaultId,
      deviceId: params.deviceId,
      filePath: params.filePath,
      resolution: params.resolution,
      content: params.content,
      hash: params.hash,
      timestamp: params.timestamp ?? Date.now()
    };
  }

  /**
   * Heartbeat  
   * 
   * @param deviceId  ID
   * @returns Heartbeat  
   */
  static createHeartbeatMessage(deviceId: string) {
    return {
      type: 'heartbeat',
      deviceId,
      timestamp: Date.now()
    };
  }
}