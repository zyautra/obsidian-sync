import { Module } from '@nestjs/common';
import { WebSocketGateway } from './websocket.gateway';
import { SyncService } from './sync.service';
import { ConnectionManagerService } from './connection-manager.service';
import { MessageHandlerService } from './message-handler.service';
import { BroadcastService } from './broadcast.service';
import { ConflictResolverService } from './conflict-resolver.service';
import { FileLockService } from './file-lock.service';
import { ChunkSessionService } from './chunk-session.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  providers: [
    WebSocketGateway,
    SyncService,
    ConnectionManagerService,
    MessageHandlerService,
    BroadcastService,
    ConflictResolverService,
    FileLockService,
    ChunkSessionService,
  ],
  exports: [
    SyncService, 
    WebSocketGateway, 
    ConnectionManagerService,
    MessageHandlerService,
    BroadcastService,
    ConflictResolverService,
    FileLockService,
    ChunkSessionService,
  ],
})
export class SyncModule {}