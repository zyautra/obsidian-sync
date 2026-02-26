import { Module } from '@nestjs/common';
import { ConfigModule } from './modules/config/config.module';
import { ErrorModule } from './common/errors/error.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { SyncModule } from './modules/sync/sync.module';
import { LoggerModule } from './modules/logger/logger.module';

@Module({
  imports: [
    ConfigModule, // Must be first as it's global
    ErrorModule,  // Global error handling
    LoggerModule, 
    PrismaModule, 
    SyncModule
  ],
})
export class AppModule {}
