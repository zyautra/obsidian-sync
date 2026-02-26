import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ChunkManager } from '../../src/upload/chunk-manager';

describe('ChunkManager protocol fields', () => {
  let sendMessage: jest.Mock;
  let sendBinary: jest.Mock;
  let manager: ChunkManager;

  beforeEach(() => {
    sendMessage = jest.fn(() => true);
    sendBinary = jest.fn(() => true);
    manager = new ChunkManager(
      sendMessage as any,
      sendBinary as any,
      () => 'vault-1',
      () => 'device-1'
    );
  });

  afterEach(() => {
    manager.dispose();
  });

  it('should send chunk-upload-start with fileHash/fileSize fields', async () => {
    const file = {
      path: 'assets/image.png',
      stat: { mtime: 12345 },
      vault: {
        readBinary: jest.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      },
    } as any;

    const started = await manager.startChunkUpload(file);
    expect(started).toBe(true);

    const startMessage = sendMessage.mock.calls[0][0] as any;
    expect(startMessage.type).toBe('chunk-upload-start');
    expect(startMessage.fileHash).toBeDefined();
    expect(startMessage.fileSize).toBe(4);
    expect(startMessage.hash).toBeUndefined();
    expect(startMessage.totalSize).toBeUndefined();
  });

  it('should send chunk-upload-complete with fileHash/fileSize fields', async () => {
    const file = {
      path: 'assets/video.mp4',
      stat: { mtime: 12345 },
      vault: {
        readBinary: jest.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      },
    } as any;

    await manager.startChunkUpload(file);
    (manager as any).sendUploadComplete(file.path);

    const calls = sendMessage.mock.calls.map((call) => call[0] as any);
    const completeMessage = calls.find((m) => m.type === 'chunk-upload-complete');
    expect(completeMessage).toBeDefined();
    expect(completeMessage.fileHash).toBeDefined();
    expect(completeMessage.fileSize).toBe(4);
    expect(completeMessage.hash).toBeUndefined();
  });
});
