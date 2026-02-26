# Obsidian Sync Workspace

This repository contains two related projects for Obsidian synchronization:

- `obsidian-auto-sync-plugin`: Obsidian plugin that watches vault file changes and syncs over WebSocket.
- `obsidian-sync-server`: WebSocket-first sync server built with NestJS + Prisma.

This repository is managed as a single monorepo (single root Git repository, separate package boundaries).

> Deployment note: This project does not provide a managed cloud sync service. You must run your own self-hosted `obsidian-sync-server` and point the plugin to that server.

## Repository Layout

```text
.
├── locales/                      # Localized docs for this root workspace
├── obsidian-auto-sync-plugin/    # Client plugin project
├── obsidian-sync-server/         # Sync server project
└── tools/                        # Workspace helper scripts
```

## Project Status

- Core text file sync flow is implemented in both plugin/server.
- Binary/chunk upload paths exist but are not fully production-hardened end-to-end yet.
- For server-specific caveats, check:
  - `obsidian-sync-server/README.md`
  - `obsidian-sync-server/locales/README.ko.md`

## Quick Start

### 1) Server (`obsidian-sync-server`)

```bash
cd obsidian-sync-server
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run start:dev
```

Default WebSocket endpoint: `ws://localhost:3001`

### 2) Plugin (`obsidian-auto-sync-plugin`)

```bash
cd obsidian-auto-sync-plugin
npm install
npm run build
```

Then copy `main.js` and `manifest.json` to your Obsidian vault plugin directory.

## Common Dev Commands

Run commands inside each project directory:

- Build: `npm run build`
- Tests: `npm test`
- Lint/format (server): `npm run lint`, `npm run format`
- Plugin integration tests: `npm run test:integration`

From the workspace root (npm workspaces):

- Install all dependencies: `npm run install:all`
- Build all packages: `npm run build:all`
- Test all packages: `npm run test:all`
- Reconcile server storage to DB metadata (optional): `./tools/reconcile-storage-to-db.sh --dry-run`

When to use `tools` scripts:
- Use `./tools/reconcile-storage-to-db.sh` when files were manually copied into server storage and clients do not receive them on initial sync.
- Reason: server `request-sync` is based on DB `File` metadata, so storage-only files are not included until metadata is reconciled.
- Start with dry-run: `./tools/reconcile-storage-to-db.sh --dry-run`
- Detailed guide: `tools/README.md`

## Documentation

- Workspace Korean doc: `locales/README.ko.md`
- Plugin details: `obsidian-auto-sync-plugin/README.md`
- Server details (EN): `obsidian-sync-server/README.md`
- Server details (KO): `obsidian-sync-server/locales/README.ko.md`
