import { StorageService } from './storage.service';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('StorageService', () => {
  let storage: StorageService;
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-sync-storage-'));
    const configService = {
      storagePath: storageRoot,
      maxFileSize: 50 * 1024 * 1024,
    } as any;
    storage = new StorageService(configService);
    await storage.onModuleInit();
  });

  afterEach(async () => {
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  it('should allow valid vault/file paths', async () => {
    await storage.writeFile('vault_1', 'docs/note.md', 'hello');
    const content = await storage.readFile('vault_1', 'docs/note.md');
    expect(content).toBe('hello');
  });

  it('should reject path traversal attempts', async () => {
    await expect(
      storage.writeFile('vault_1', '../../tmp/pwned.txt', 'bad')
    ).rejects.toThrow('Path traversal detected');
  });

  it('should reject absolute file paths', async () => {
    await expect(
      storage.writeFile('vault_1', '/etc/passwd', 'bad')
    ).rejects.toThrow('Absolute filePath is not allowed');
  });

  it('should reject invalid vaultId values', async () => {
    await expect(
      storage.writeFile('../vault', 'note.md', 'bad')
    ).rejects.toThrow('Invalid vaultId');
  });
});
