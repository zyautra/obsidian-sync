/**
 *   
 * 
 *     
 *   .
 */
export class SettingsValidator {
  /**
   *  URL  
   * 
   * @param url  URL
   * @returns    
   */
  static validateServerUrl(url: string): { valid: boolean; error?: string } {
    if (!url || !url.trim()) {
      return { valid: false, error: 'Server URL is empty' };
    }

    const trimmedUrl = url.trim();

    // IP   
    const ipPattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    
    //    ( )
    const domainPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.?[a-zA-Z]{2,}$|^localhost$/;

    if (!ipPattern.test(trimmedUrl) && !domainPattern.test(trimmedUrl)) {
      return { 
        valid: false, 
        error: 'Please enter a valid IP address or domain name (e.g., 192.168.1.1 or example.com)' 
      };
    }

    return { valid: true };
  }

  /**
   *    
   * 
   * @param port   
   * @returns    
   */
  static validateServerPort(port: number): { valid: boolean; error?: string } {
    if (!port || isNaN(port)) {
      return { valid: false, error: 'Port is empty or invalid' };
    }

    if (port < 1 || port > 65535) {
      return { valid: false, error: 'Port must be in range 1-65535' };
    }

    //     
    if (port < 1024) {
      return { 
        valid: true, 
        error: 'Ports below 1024 are system ports and may require elevated permissions' 
      };
    }

    return { valid: true };
  }

  /**
   * Vault ID  
   * 
   * @param vaultId  Vault ID
   * @returns    
   */
  static validateVaultId(vaultId: string): { valid: boolean; error?: string } {
    if (!vaultId || !vaultId.trim()) {
      return { valid: false, error: 'Vault ID is empty' };
    }

    const trimmedId = vaultId.trim();

    // , , ,  
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
      return { 
        valid: false, 
        error: 'Vault ID can only contain letters, numbers, underscore (_), and hyphen (-)' 
      };
    }

    //  
    if (trimmedId.length < 1 || trimmedId.length > 50) {
      return { 
        valid: false, 
        error: 'Vault ID must be between 1 and 50 characters' 
      };
    }

    //      
    if (!/^[a-zA-Z0-9].*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/.test(trimmedId)) {
      return { 
        valid: false, 
        error: 'Vault ID must start and end with a letter or number' 
      };
    }

    return { valid: true };
  }

  /**
   *    
   * 
   * @param deviceName   
   * @returns    
   */
  static validateDeviceName(deviceName: string): { valid: boolean; error?: string } {
    if (!deviceName || !deviceName.trim()) {
      return { valid: false, error: 'Device name is empty' };
    }

    const trimmedName = deviceName.trim();

    //  
    if (trimmedName.length < 1 || trimmedName.length > 100) {
      return { 
        valid: false, 
        error: 'Device name must be between 1 and 100 characters' 
      };
    }

    //   
    if (/[\x00-\x1f\x7f]/.test(trimmedName)) {
      return { 
        valid: false, 
        error: 'Device name cannot contain control characters' 
      };
    }

    return { valid: true };
  }

  /**
   *    
   * 
   * @param interval    ()
   * @returns    
   */
  static validateSyncInterval(interval: number): { valid: boolean; error?: string } {
    if (!interval || isNaN(interval)) {
      return { valid: false, error: 'Sync interval is empty or invalid' };
    }

    if (interval < 100) {
      return { 
        valid: false, 
        error: 'Sync interval must be at least 100ms' 
      };
    }

    if (interval > 300000) { // 5
      return { 
        valid: false, 
        error: 'Sync interval cannot exceed 5 minutes (300000ms)' 
      };
    }

    //    
    if (interval < 500) {
      return { 
        valid: true, 
        error: 'Intervals below 500ms may impact system performance' 
      };
    }

    return { valid: true };
  }

  /**
   *    
   * 
   * @param settings   
   * @returns    
   */
  static validateAllSettings(settings: {
    serverUrl: string;
    serverPort: number;
    vaultId: string;
    deviceName: string;
    syncInterval: number;
  }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const urlResult = this.validateServerUrl(settings.serverUrl);
    if (!urlResult.valid && urlResult.error) {
      errors.push(`Server URL: ${urlResult.error}`);
    }

    const portResult = this.validateServerPort(settings.serverPort);
    if (!portResult.valid && portResult.error) {
      errors.push(`Server Port: ${portResult.error}`);
    }

    const vaultResult = this.validateVaultId(settings.vaultId);
    if (!vaultResult.valid && vaultResult.error) {
      errors.push(`Vault ID: ${vaultResult.error}`);
    }

    const deviceResult = this.validateDeviceName(settings.deviceName);
    if (!deviceResult.valid && deviceResult.error) {
      errors.push(`Device Name: ${deviceResult.error}`);
    }

    const intervalResult = this.validateSyncInterval(settings.syncInterval);
    if (!intervalResult.valid && intervalResult.error) {
      errors.push(`Sync Interval: ${intervalResult.error}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   *    
   *      .
   * 
   * @param settings   
   * @returns    
   */
  static validateForConnection(settings: {
    serverUrl: string;
    serverPort: number;
    vaultId: string;
  }): { canConnect: boolean; message?: string } {
    const urlResult = this.validateServerUrl(settings.serverUrl);
    if (!urlResult.valid) {
      return { 
        canConnect: false, 
        message: `Invalid server URL: ${urlResult.error}` 
      };
    }

    const portResult = this.validateServerPort(settings.serverPort);
    if (!portResult.valid) {
      return { 
        canConnect: false, 
        message: `Invalid server port: ${portResult.error}` 
      };
    }

    const vaultResult = this.validateVaultId(settings.vaultId);
    if (!vaultResult.valid) {
      return { 
        canConnect: false, 
        message: `Invalid Vault ID: ${vaultResult.error}` 
      };
    }

    return { canConnect: true };
  }
}
