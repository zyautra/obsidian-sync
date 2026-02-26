import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WebSocketGateway } from './modules/sync/websocket.gateway';
import { LoggerService } from './modules/logger/logger.service';
import { ConfigService } from './modules/config/config.service';

async function bootstrap() {
  try {
    // Create NestJS application context (without HTTP server)
    const app = await NestFactory.createApplicationContext(AppModule);
    
    // Get services
    const configService = app.get(ConfigService);
    const logger = app.get(LoggerService);
    
    // Validate configuration
    configService.validateRequiredEnvVars();
    
    // Get WebSocket gateway and start WebSocket server
    const wsGateway = app.get(WebSocketGateway);
    wsGateway.startServer(configService.wsPort);
  
    logger.log(
      `Obsidian Sync Server started (WebSocket only mode) on port ${configService.wsPort}`,
      'Bootstrap',
      {
        port: configService.wsPort,
        environment: configService.nodeEnv,
        storagePath: configService.storagePath,
      }
    );
  
    // Keep the process alive
    process.on('SIGTERM', async () => {
      logger.log('Received SIGTERM, shutting down gracefully', 'Bootstrap');
      wsGateway.closeServer();
      await app.close();
      process.exit(0);
    });
    
    process.on('SIGINT', async () => {
      logger.log('Received SIGINT, shutting down gracefully', 'Bootstrap');
      wsGateway.closeServer();
      await app.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start application:', error.message);
    if (error.message.includes('Configuration validation failed')) {
      console.error('\nPlease check your environment variables and try again.');
    }
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  console.error('Unexpected error during bootstrap:', error);
  process.exit(1);
});
