# Obsidian Sync Server

A WebSocket-first sync server for Obsidian vaults built with NestJS and TypeScript.

This project keeps:
- file metadata in SQLite (via Prisma)
- file contents on local disk under `STORAGE_PATH`

## Current Scope

- Real-time sync over WebSocket
- Device registration and vault isolation
- File operations: update/create, delete, rename
- Conflict checks (hash/timestamp based)
- File lock API with expiration
- Initial sync (`request-sync`) responses
- Structured logging with daily folders

## Implementation Status

- Stable for core text-file sync flows
- `binary-file-change` and chunk-upload message types exist
- Chunk upload path is currently partial/in-progress (not fully integrated end-to-end)
- Rename and binary handling paths need extra validation before production-critical use

## Architecture

- Runtime: Node.js + NestJS application context (no HTTP server bootstrap)
- Transport: `ws` WebSocket server
- Persistence:
  - SQLite: vault/device/file metadata, lock state, sync operations
  - Filesystem: actual file contents in `STORAGE_PATH/<vaultId>/...`

High-level flow:
1. Client connects and sends `register-device`
2. Client sends file operation messages
3. Server validates, updates DB in transactions, writes file storage
4. Server broadcasts changes to other clients in the same vault

## Requirements

- Node.js 18+
- SQLite (file-based, via Prisma)

## Quick Start

```bash
# 1) install
npm install

# 2) set env
cp .env.example .env
# then edit .env

# 3) prisma
npx prisma generate
npx prisma db push

# 4) run
npm run start:dev
# or
npm start
```

Default WebSocket URL: `ws://localhost:3001`

## Environment Variables

| Variable | Default | Required | Description |
|---|---:|:---:|---|
| `DATABASE_URL` | `file:./sqlite.db` | Yes | Prisma database URL (SQLite by default) |
| `WS_PORT` | `3001` | No | WebSocket server port |
| `STORAGE_PATH` | `./obsidian` | No | Base path for vault file storage |
| `MAX_FILE_SIZE` | `52428800` (50MB) | No | Max file size for storage write validation |
| `RATE_LIMIT_WINDOW` | `30000` | No | Rate-limit window (ms) |
| `RATE_LIMIT_MAX_MESSAGES` | `100` | No | Max messages per window per client |
| `FILE_LOCK_EXPIRATION` | `30000` | No | Lock expiration time (ms) |
| `HEARTBEAT_INTERVAL` | `30000` | No | Ping interval (ms) |
| `LOG_LEVEL` | `info` | No | `error`, `warn`, `info`, `debug`, `verbose` |
| `NODE_ENV` | `development` | No | `development`, `production`, `test` |

## Limits And Sizing

- Storage write validation limit (`MAX_FILE_SIZE`) default: `50MB`
- WebSocket transport payload limit (`ws` `maxPayload`) default: `30MB`
- `binary-file-change` uses base64 JSON payload, so transfer size is larger than raw binary (about +33%)
- Recommended client behavior: keep inline `binary-file-change` payloads at or below about `10MB` raw file size and use chunk upload above that

## WebSocket Message Types

Client -> Server:
- `register-device`
- `file-change`
- `binary-file-change`
- `file-delete`
- `file-rename`
- `request-lock`
- `request-sync`
- `resolve-conflict`
- `chunk-upload-start`
- `chunk-data`
- `chunk-upload-complete`
- `heartbeat`

Server -> Client:
- `register-device-response`
- `file-change`
- `file-delete`
- `file-rename`
- `file-change-response`
- `lock-acquired`, `lock-denied`
- `sync-response`
- `initial-sync-complete`
- `chunk-upload-response`
- `heartbeat-response`
- `error`

## Database Models

Main models in `prisma/schema.prisma`:
- `Vault`
- `Device`
- `File` (metadata only)
- `FileLock`
- `SyncOperation`
- `FileOperation`

## Scripts

```bash
npm run build
npm start
npm run start:dev
npm run start:debug

npm test
npm run test:watch
npm run test:e2e
npm run test:cov

npm run lint
npm run format
```

Background helpers:
```bash
./scripts/start.sh
./scripts/stop.sh
./scripts/restart.sh
./scripts/status.sh
```

Workspace helper (run from repository root):
```bash
./tools/reconcile-storage-to-db.sh --dry-run
```

When to use this helper:
- A file exists under `STORAGE_PATH/<vaultId>/...` but clients do not receive it in initial sync.
- You imported/copied files directly on server storage (outside normal client sync flow).
- You migrated storage data and need DB `File` metadata alignment.

Reason:
- `request-sync` responses are DB-driven. Storage-only files are not sent until metadata is reconciled.

Recommended flow:
1. `./tools/reconcile-storage-to-db.sh --dry-run`
2. `./tools/reconcile-storage-to-db.sh --vault <vaultId>` (or without `--vault` for full scan)
3. Reconnect client or run `Force Sync Now`

`--prune` warning:
- `--prune` removes DB rows missing on disk. Use only after verifying intended deletions.

Detailed guide:
- `tools/README.md`

## Logging

Logs are written under date folders and symlinked current files:
- `logs/application.log`
- `logs/error.log`
- `logs/YYYY/MM/DD/application.log`
- `logs/YYYY/MM/DD/error.log`

## Notes and Caveats

- The app bootstraps as WebSocket-only (`createApplicationContext`), not as an HTTP REST server.
- A `VaultController` exists in source, but it is not wired into the current runtime module graph.
- Chunk upload and some binary/rename edge paths should be treated as beta-level behavior.

## License

`UNLICENSED` (see `package.json`).
