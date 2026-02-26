#!/usr/bin/env bash
set -euo pipefail

# Reconcile server filesystem files into DB File metadata for initial sync.
# Usage:
#   tools/reconcile-storage-to-db.sh [--vault <vaultId>] [--dry-run] [--prune]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$ROOT_DIR/obsidian-sync-server"
ENV_FILE="$SERVER_DIR/.env"

VAULT_FILTER=""
DRY_RUN="0"
PRUNE="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault)
      VAULT_FILTER="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
      ;;
    --prune)
      PRUNE="1"
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: tools/reconcile-storage-to-db.sh [--vault <vaultId>] [--dry-run] [--prune]

Options:
  --vault <vaultId>  Reconcile only one vault directory.
  --dry-run          Print planned changes without writing DB.
  --prune            Remove DB file rows that do not exist on disk.
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$SERVER_DIR" ]]; then
  echo "Server directory not found: $SERVER_DIR" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo ".env not found: $ENV_FILE" >&2
  exit 1
fi

cd "$SERVER_DIR"

# Expose .env keys to child process.
set -a
source "$ENV_FILE"
set +a

export VAULT_FILTER DRY_RUN PRUNE

node <<'NODE'
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const VAULT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const prisma = new PrismaClient();

function resolveStorageRoot(rawPath) {
  if (rawPath.startsWith('~/')) {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  return path.resolve(rawPath);
}

async function listVaultDirs(storageRoot, vaultFilter) {
  if (vaultFilter) {
    return [vaultFilter];
  }
  const entries = await fs.readdir(storageRoot, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function walkFiles(baseDir, relativeDir = '') {
  const currentDir = path.join(baseDir, relativeDir);
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const out = [];

  for (const entry of entries) {
    const rel = path.posix.join(relativeDir.split(path.sep).join('/'), entry.name);
    const full = path.join(baseDir, rel);
    if (entry.isDirectory()) {
      out.push(...await walkFiles(baseDir, rel));
    } else if (entry.isFile()) {
      out.push({ relPath: rel, fullPath: full });
    }
  }
  return out;
}

async function hashAndStats(fullPath) {
  const content = await fs.readFile(fullPath, 'utf8');
  const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const stat = await fs.stat(fullPath);
  const size = Buffer.byteLength(content, 'utf8');
  return { hash, size, mtime: stat.mtime };
}

async function run() {
  const storagePathRaw = process.env.STORAGE_PATH || './obsidian';
  const storageRoot = resolveStorageRoot(storagePathRaw);
  const vaultFilter = process.env.VAULT_FILTER || '';
  const dryRun = process.env.DRY_RUN === '1';
  const prune = process.env.PRUNE === '1';

  let upserted = 0;
  let pruned = 0;
  let skippedVaults = 0;

  console.log(`[reconcile] storage root: ${storageRoot}`);
  if (vaultFilter) {
    console.log(`[reconcile] vault filter: ${vaultFilter}`);
  }
  if (dryRun) {
    console.log('[reconcile] dry-run mode: enabled');
  }
  if (prune) {
    console.log('[reconcile] prune mode: enabled');
  }

  const vaultIds = await listVaultDirs(storageRoot, vaultFilter);

  for (const vaultId of vaultIds) {
    if (!VAULT_ID_PATTERN.test(vaultId)) {
      console.log(`[reconcile] skip invalid vaultId: ${vaultId}`);
      skippedVaults += 1;
      continue;
    }

    const vaultDir = path.join(storageRoot, vaultId);
    const files = await walkFiles(vaultDir);
    const diskPathSet = new Set();

    if (!dryRun) {
      await prisma.vault.upsert({
        where: { id: vaultId },
        update: {},
        create: {
          id: vaultId,
          name: `Vault-${vaultId.substring(0, 8)}`,
        },
      });
    }

    for (const file of files) {
      const relPath = file.relPath.split(path.sep).join('/');
      diskPathSet.add(relPath);
      const { hash, size, mtime } = await hashAndStats(file.fullPath);

      if (!dryRun) {
        await prisma.file.upsert({
          where: {
            vaultId_path: {
              vaultId,
              path: relPath,
            },
          },
          update: {
            hash,
            size,
            mtime,
          },
          create: {
            vaultId,
            path: relPath,
            hash,
            size,
            mtime,
          },
        });
      }
      upserted += 1;
    }

    if (prune) {
      const dbFiles = await prisma.file.findMany({
        where: { vaultId },
        select: { id: true, path: true },
      });

      const staleIds = dbFiles.filter((f) => !diskPathSet.has(f.path)).map((f) => f.id);

      if (!dryRun && staleIds.length > 0) {
        const chunkSize = 500;
        for (let i = 0; i < staleIds.length; i += chunkSize) {
          const chunk = staleIds.slice(i, i + chunkSize);
          await prisma.file.deleteMany({ where: { id: { in: chunk } } });
        }
      }
      pruned += staleIds.length;
    }

    console.log(`[reconcile] vault=${vaultId} files_on_disk=${files.length}`);
  }

  console.log(
    `[reconcile] done upserted=${upserted} pruned=${pruned} skipped_vaults=${skippedVaults}`
  );
}

run()
  .catch((err) => {
    console.error('[reconcile] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
NODE
