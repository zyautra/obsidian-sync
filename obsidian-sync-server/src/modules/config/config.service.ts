import { Injectable } from '@nestjs/common';
import { config } from 'dotenv';
import * as path from 'path';
import * as os from 'os';

interface AppConfig {
  // Server Configuration
  wsPort: number;
  logLevel: string;
  
  // Database Configuration
  databaseUrl: string;
  
  // Storage Configuration
  storagePath: string;
  maxFileSize: number;
  
  // Performance Configuration
  rateLimitWindow: number;
  rateLimitMaxMessages: number;
  fileLockExpiration: number;
  heartbeatInterval: number;
  
  // Environment
  nodeEnv: string;
  isDevelopment: boolean;
  isProduction: boolean;
}

@Injectable()
export class ConfigService {
  private readonly config: AppConfig;

  constructor() {
    // Load environment variables
    config();
    
    this.config = this.loadAndValidateConfig();
  }

  private loadAndValidateConfig(): AppConfig {
    const errors: string[] = [];
    
    // Required environment variables
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      errors.push('DATABASE_URL is required');
    }
    
    // Parse and validate numeric values
    const wsPort = this.parseIntWithDefault(process.env.WS_PORT, 3001);
    if (wsPort < 1 || wsPort > 65535) {
      errors.push('WS_PORT must be between 1 and 65535');
    }
    
    const maxFileSize = this.parseIntWithDefault(process.env.MAX_FILE_SIZE, 50 * 1024 * 1024);
    if (maxFileSize < 1024) {
      errors.push('MAX_FILE_SIZE must be at least 1KB');
    }
    
    // Validate storage path
    const storagePath = process.env.STORAGE_PATH || './obsidian';
    if (!path.isAbsolute(storagePath) && !storagePath.startsWith('./') && !storagePath.startsWith('~/')) {
      errors.push('STORAGE_PATH must be absolute path, relative path starting with "./" or home directory path starting with "~/"');
    }
    
    // Validate log level
    const logLevel = process.env.LOG_LEVEL || 'info';
    const validLogLevels = ['error', 'warn', 'info', 'debug', 'verbose'];
    if (!validLogLevels.includes(logLevel)) {
      errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
    }
    
    // Environment validation
    const nodeEnv = process.env.NODE_ENV || 'development';
    const validEnvs = ['development', 'production', 'test'];
    if (!validEnvs.includes(nodeEnv)) {
      errors.push(`NODE_ENV must be one of: ${validEnvs.join(', ')}`);
    }
    
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.map(e => `- ${e}`).join('\n')}`);
    }
    
    return {
      // Server Configuration
      wsPort,
      logLevel,
      
      // Database Configuration
      databaseUrl: databaseUrl!,
      
      // Storage Configuration
      storagePath: path.resolve(this.expandHomeDirectory(storagePath)),
      maxFileSize,
      
      // Performance Configuration
      rateLimitWindow: this.parseIntWithDefault(process.env.RATE_LIMIT_WINDOW, 30000),
      rateLimitMaxMessages: this.parseIntWithDefault(process.env.RATE_LIMIT_MAX_MESSAGES, 100),
      fileLockExpiration: this.parseIntWithDefault(process.env.FILE_LOCK_EXPIRATION, 30000),
      heartbeatInterval: this.parseIntWithDefault(process.env.HEARTBEAT_INTERVAL, 30000),
      
      // Environment
      nodeEnv,
      isDevelopment: nodeEnv === 'development',
      isProduction: nodeEnv === 'production',
    };
  }
  
  private parseIntWithDefault(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  
  private expandHomeDirectory(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }
    return filePath;
  }
  
  // Getters for configuration values
  get wsPort(): number { return this.config.wsPort; }
  get logLevel(): string { return this.config.logLevel; }
  get databaseUrl(): string { return this.config.databaseUrl; }
  get storagePath(): string { return this.config.storagePath; }
  get maxFileSize(): number { return this.config.maxFileSize; }
  get rateLimitWindow(): number { return this.config.rateLimitWindow; }
  get rateLimitMaxMessages(): number { return this.config.rateLimitMaxMessages; }
  get fileLockExpiration(): number { return this.config.fileLockExpiration; }
  get heartbeatInterval(): number { return this.config.heartbeatInterval; }
  get nodeEnv(): string { return this.config.nodeEnv; }
  get isDevelopment(): boolean { return this.config.isDevelopment; }
  get isProduction(): boolean { return this.config.isProduction; }
  
  // Utility methods
  getConfig(): Readonly<AppConfig> {
    return { ...this.config };
  }
  
  validateRequiredEnvVars(): void {
    // This method is called during construction, but can be used for runtime checks
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required');
    }
  }
}