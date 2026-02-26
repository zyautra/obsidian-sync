/**
 *   
 * 
 *      .
 */
export class ErrorUtils {
  /**
   *    
   * 
   * @param error  
   * @param fallback  
   * @returns   
   */
  static getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
    if (error instanceof Error) {
      return error.message || fallback;
    }
    
    if (typeof error === 'string') {
      return error || fallback;
    }
    
    if (error && typeof error === 'object') {
      //   message  
      const errorObj = error as Record<string, unknown>;
      if (typeof errorObj.message === 'string') {
        return errorObj.message || fallback;
      }
      
      // toString() 
      try {
        const stringified = errorObj.toString();
        if (stringified !== '[object Object]') {
          return stringified;
        }
      } catch {
        // toString()   
      }
      
      // JSON.stringify()  (  )
      try {
        return JSON.stringify(error);
      } catch {
        // JSON.stringify()   
      }
    }
    
    return fallback;
  }

  /**
   *   
   * 
   * @param context   
   * @param error  
   * @param additionalInfo  
   */
  static logError(context: string, error: unknown, additionalInfo?: Record<string, unknown>): void {
    const errorMessage = this.getErrorMessage(error);
    const timestamp = new Date().toISOString();
    
    const logEntry = {
      timestamp,
      context,
      error: errorMessage,
      originalError: error,
      ...additionalInfo
    };
    
    console.error(`[${context}] ${errorMessage}`, logEntry);
  }

  /**
   *      
   * 
   * @param error  
   * @param context   
   * @returns   
   */
  static getUserFriendlyMessage(error: unknown, context?: string): string {
    const errorMessage = this.getErrorMessage(error);
    
    //   
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('connection refused')) {
      return 'Unable to connect to server. Please check whether the server is running.';
    }
    
    if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
      return 'Connection timed out. Please check your network status.';
    }
    
    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('not found')) {
      return 'Server address not found. Please check your settings.';
    }
    
    // WebSocket  
    if (errorMessage.includes('WebSocket') || errorMessage.includes('websocket')) {
      return 'There is a WebSocket connection issue. Please verify server settings.';
    }
    
    //   
    if (errorMessage.includes('ENOENT') || errorMessage.includes('no such file')) {
      return 'File not found.';
    }
    
    if (errorMessage.includes('EACCES') || errorMessage.includes('permission')) {
      return 'File permission denied.';
    }
    
    //  
    if (context) {
      return `An error occurred during ${context}: ${errorMessage}`;
    }
    
    return errorMessage || 'An unknown error occurred.';
  }

  /**
   *     
   * 
   * @param error  
   * @returns   
   */
  static isRetryableError(error: unknown): boolean {
    const errorMessage = this.getErrorMessage(error).toLowerCase();
    
    //   
    if (errorMessage.includes('etimedout') || 
        errorMessage.includes('econnreset') ||
        errorMessage.includes('econnaborted') ||
        errorMessage.includes('socket hang up')) {
      return true;
    }
    
    //  
    if (errorMessage.includes('503') || errorMessage.includes('service unavailable')) {
      return true;
    }
    
    return false;
  }

  /**
   *     
   * 
   * @param error  
   * @returns   
   */
  static getStackTrace(error: unknown): string | undefined {
    if (error instanceof Error && error.stack) {
      return error.stack;
    }
    
    if (error && typeof error === 'object') {
      const errorObj = error as Record<string, unknown>;
      if (typeof errorObj.stack === 'string') {
        return errorObj.stack;
      }
    }
    
    return undefined;
  }
}
