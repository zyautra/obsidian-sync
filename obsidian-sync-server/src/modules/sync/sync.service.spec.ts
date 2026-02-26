import { SyncService } from './sync.service';

describe('SyncService', () => {
  it('should preserve file hash/size and avoid content rewrite on rename', async () => {
    const existingFile = {
      id: 'file-1',
      vaultId: 'vault-1',
      path: 'old.md',
      hash: 'existing-hash',
      size: 123,
      version: 2,
      mtime: new Date('2026-02-25T00:00:00.000Z'),
    };

    const updatedFile = {
      ...existingFile,
      path: 'new.md',
      version: 3,
    };

    const tx = {
      syncOperation: {
        create: jest.fn().mockResolvedValue({ id: 'sync-op-1' }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      file: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(existingFile)
          .mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValue(updatedFile),
      },
    };

    const prisma = {
      device: {
        findUnique: jest.fn().mockResolvedValue({ id: 'device-db-1' }),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;

    const storage = {
      renameFile: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
    } as any;

    const configService = { maxFileSize: 50 * 1024 * 1024 } as any;
    const errorHandler = {
      handleError: jest.fn((error: Error) => error),
    } as any;
    const conflictResolver = {
      resolveRenameConflict: jest.fn().mockReturnValue({ action: 'accept', reason: 'ok' }),
      resolveFileConflict: jest.fn(),
      resolveDeleteConflict: jest.fn(),
      logConflictResolution: jest.fn(),
    } as any;
    const fileLockService = {} as any;

    const service = new SyncService(
      prisma,
      storage,
      configService,
      errorHandler,
      conflictResolver,
      fileLockService
    );

    const result = await service.processFileChange({
      vaultId: 'vault-1',
      deviceId: 'device-1',
      filePath: 'old.md',
      newPath: 'new.md',
      content: '',
      operationType: 'RENAME',
      clientTimestamp: Date.now(),
    });

    expect(result).toEqual({
      success: true,
      version: 3,
      hash: 'existing-hash',
    });

    expect(tx.file.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          path: 'new.md',
          version: { increment: 1 },
        }),
      })
    );
    expect(tx.file.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hash: expect.anything(),
        }),
      })
    );
    expect(tx.file.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          size: expect.anything(),
        }),
      })
    );

    expect(storage.renameFile).toHaveBeenCalledWith('vault-1', 'old.md', 'new.md');
    expect(storage.writeFile).not.toHaveBeenCalled();
  });
});
