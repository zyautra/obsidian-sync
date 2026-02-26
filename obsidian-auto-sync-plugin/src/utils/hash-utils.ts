import * as crypto from 'crypto-js';

/**
 *      
 */
export class HashUtils {
  /**
   *   SHA256  
   * 
   * @param content  
   * @returns SHA256  
   */
  static generateFileHash(content: string): string {
    return crypto.SHA256(content).toString();
  }

  /**
   *   SHA256  
   * 
   * @param buffer ArrayBuffer  
   * @returns SHA256  
   */
  static generateBinaryHash(buffer: ArrayBuffer): string {
    // ArrayBuffer WordArray    
    const wordArray = crypto.lib.WordArray.create(buffer);
    return crypto.SHA256(wordArray).toString();
  }

  /**
   *    
   * 
   * @param hash1   
   * @param hash2   
   * @returns   
   */
  static compareHashes(hash1: string, hash2: string): boolean {
    return hash1 === hash2;
  }


  /**
   * ArrayBuffer Base64  
   * 
   * @param buffer  ArrayBuffer
   * @returns Base64  
   */
  static arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Base64  ArrayBuffer 
   * 
   * @param base64 Base64  
   * @returns ArrayBuffer
   */
  static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   *   SHA256  
   * 
   * @param hash   
   * @returns   
   */
  static isValidHash(hash: string): boolean {
    return /^[a-f0-9]{64}$/i.test(hash);
  }
}