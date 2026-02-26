import { Injectable, ConsoleLogger } from '@nestjs/common';
import * as winston from 'winston';
import * as path from 'path';
import { promises as fs } from 'fs';

// Custom transport for date-based folder structure
class DateBasedFileTransport extends winston.transports.File {
  constructor(opts: any) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    
    const dateFolder = `${year}/${month}/${day}`;
    const logDir = path.join('logs', dateFolder);
    const filename = path.join(logDir, opts.basename);
    
    // Ensure directory exists
    fs.mkdir(logDir, { recursive: true }).catch(() => {});
    
    super({
      ...opts,
      filename,
    });
    
    // Create symlink to current log
    this.createSymlink(filename, path.join('logs', opts.basename));
  }
  
  private async createSymlink(target: string, linkPath: string) {
    try {
      // Remove existing symlink/file
      await fs.unlink(linkPath).catch(() => {});
      
      // Create relative symlink
      const relativePath = path.relative(path.dirname(linkPath), target);
      await fs.symlink(relativePath, linkPath);
    } catch (error) {
      // Symlink creation failed, not critical
    }
  }
}

@Injectable()
export class LoggerService extends ConsoleLogger {
  private readonly logger: winston.Logger;

  constructor() {
    super();
    
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'obsidian-sync-server' },
      transports: [
        // Console transport for development
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
              const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
              return `${timestamp} [${level}]: ${message}${metaStr}`;
            })
          )
        }),
        
        // Date-based folder structure for application logs
        new DateBasedFileTransport({
          basename: 'application.log',
          maxsize: 20 * 1024 * 1024, // 20MB
          maxFiles: 30,
        }),
        
        // Date-based folder structure for error logs
        new DateBasedFileTransport({
          basename: 'error.log',
          level: 'error',
          maxsize: 20 * 1024 * 1024, // 20MB
          maxFiles: 30,
        }),
      ],
    });
  }

  log(message: string, context?: string, meta?: any) {
    this.logger.info(message, { context, ...meta });
  }

  error(message: string, trace?: string, context?: string, meta?: any) {
    this.logger.error(message, { context, trace, ...meta });
  }

  warn(message: string, context?: string, meta?: any) {
    this.logger.warn(message, { context, ...meta });
  }

  debug(message: string, context?: string, meta?: any) {
    this.logger.debug(message, { context, ...meta });
  }

  verbose(message: string, context?: string, meta?: any) {
    this.logger.verbose(message, { context, ...meta });
  }

  // Custom methods for specific use cases
  logFileOperation(operation: string, filePath: string, deviceId: string, vaultId: string, success: boolean, duration?: number) {
    this.logger.info(`File operation: ${operation}`, {
      context: 'FileSync',
      filePath,
      deviceId,
      vaultId,
      success,
      duration,
      timestamp: new Date().toISOString(),
    });
  }

  logWebSocketEvent(event: string, clientIp?: string, deviceId?: string, vaultId?: string, meta?: any) {
    this.logger.info(`WebSocket event: ${event}`, {
      context: 'WebSocket',
      clientIp,
      deviceId,
      vaultId,
      ...meta,
      timestamp: new Date().toISOString(),
    });
  }

  logPerformanceMetric(operation: string, duration: number, meta?: any) {
    if (duration > 1000) {
      this.logger.warn(`Slow operation: ${operation} took ${duration}ms`, {
        context: 'Performance',
        operation,
        duration,
        ...meta,
      });
    } else {
      this.logger.debug(`Operation completed: ${operation} in ${duration}ms`, {
        context: 'Performance',
        operation,
        duration,
        ...meta,
      });
    }
  }

  logDatabaseOperation(operation: string, table: string, success: boolean, duration?: number, error?: string) {
    this.logger.info(`Database operation: ${operation} on ${table}`, {
      context: 'Database',
      operation,
      table,
      success,
      duration,
      error,
    });
  }
}