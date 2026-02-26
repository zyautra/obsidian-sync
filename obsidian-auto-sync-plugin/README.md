# Obsidian Auto Sync Plugin

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Obsidian](https://img.shields.io/badge/obsidian-0.15.0+-purple.svg)

Real-time vault synchronization plugin for Obsidian.
It syncs create/update/delete/rename events across devices through a WebSocket sync server.

> Deployment note: This plugin requires a self-hosted `obsidian-sync-server`. No managed cloud sync service is provided by this project.

## Features

- Bi-directional file sync for text and binary files
- Debounced batch processing for rapid edits
- SHA-256 based conflict checks
- Chunk upload path for large files
- Automatic reconnect and heartbeat monitoring
- Device registration and vault isolation support

## Quick Start

### 1) Prepare server

Run the server project first:

```bash
cd ../obsidian-sync-server
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run start:dev
```

Default endpoint: `ws://localhost:3001`

### 2) Build plugin

```bash
npm install
npm run build
```

### 3) Install into Obsidian

Copy these files into your vault plugin directory:

- `main.js`
- `manifest.json`

Then enable **Auto Sync** in Obsidian community plugins.

## Plugin Settings

Configure in: `Settings -> Community plugins -> Auto Sync`

| Setting | Default | Description |
|---|---:|---|
| `Server URL` | `localhost` | Hostname or IP only. Do not include `ws://`. |
| `Server Port` | `3001` | WebSocket server port. |
| `Vault ID` | auto-detected | Vault identifier shared by devices syncing the same vault. |
| `Device Name` | device hostname | Human-friendly device label. |
| `Enable Auto Sync` | `true` | Toggle automatic sync. |
| `Sync Interval` | `1000` ms | Flush/poll interval for queued sync work. |

## Usage

- Turn on `Enable Auto Sync`.
- Check status bar:
  - `🟢 Sync`: connected and active
  - `🟡 Sync`: connecting/reconnecting
  - `⭕ Sync`: disabled

Commands:
- `Toggle Auto Sync`
- `Force Sync Now`

## Development

```bash
npm install
npm run dev
npm run build
```

## Tests

```bash
npm test
npm run test:watch
npm run test:coverage
npm run test:integration
```

Notes:
- `test:integration` requires a running sync server.
- See `tests/README.md` for integration setup details.

## Operational Notes

- Large binaries may use chunk upload and complete slower than text updates.
- Reconnect/retry improves resilience but does not guarantee conflict-free results without sane vault ID and device configuration.
- Use stable network and verify server logs when diagnosing missed updates.

## Troubleshooting Checklist

Connection problems:
1. Confirm server is running.
2. Verify `Server URL` and `Server Port`.
3. Check firewall and LAN routing.

Sync delays:
1. Check network quality.
2. Review large file activity (chunk upload path).
3. Adjust `Sync Interval`.

Missing file events:
1. Verify same `Vault ID` across devices.
2. Check excluded/temp files.
3. Run `Force Sync Now`.
4. If file exists on server disk but is still missing, ask server operator to run `./tools/reconcile-storage-to-db.sh --dry-run` from repo root (see `tools/README.md`).

## Localization

- Korean documentation: `locales/README.ko.md`

## License

MIT
