# Tools Guide

This directory contains operational helper scripts for the workspace.

## `reconcile-storage-to-db.sh`

Path: `tools/reconcile-storage-to-db.sh`

Purpose:
- Reconcile server filesystem files into DB `File` metadata rows.
- Fix "file exists on server storage, but not included in `sync-response`" cases.

Why this is needed:
- `request-sync` is DB-driven, not a raw filesystem scan.
- If a file exists under `STORAGE_PATH/<vaultId>/...` but has no `File` row, clients will not receive it during initial sync.

### When to use

Use this script when at least one of these applies:
- You manually copied/created files directly in server storage.
- You migrated storage data from another host and DB metadata may be incomplete.
- A client reports missing files after `Force Sync`, but the file exists on server disk.
- You want periodic maintenance to keep storage and DB metadata aligned.

Avoid using this as your default sync path:
- Normal operation should flow through plugin/client upload and sync messages.

### Prerequisites

- Run from repository root.
- Server `.env` must exist at `obsidian-sync-server/.env`.
- `DATABASE_URL` and `STORAGE_PATH` must be correctly configured.
- Install server dependencies first:

```bash
cd obsidian-sync-server
npm install
```

### Basic usage

Dry-run first (recommended):

```bash
./tools/reconcile-storage-to-db.sh --dry-run
```

Apply changes:

```bash
./tools/reconcile-storage-to-db.sh
```

Single vault only:

```bash
./tools/reconcile-storage-to-db.sh --vault <vaultId> --dry-run
./tools/reconcile-storage-to-db.sh --vault <vaultId>
```

Prune stale DB rows that no longer exist on disk:

```bash
./tools/reconcile-storage-to-db.sh --prune --dry-run
./tools/reconcile-storage-to-db.sh --prune
```

### Option reference

- `--vault <vaultId>`: reconcile only one vault directory.
- `--dry-run`: print planned changes without DB writes.
- `--prune`: remove DB `File` rows that are missing on disk.

### Safe operation checklist

1. Run `--dry-run` and review output.
2. Apply only for intended vault (`--vault`) if scope is limited.
3. Use `--prune` only after confirming deleted-on-disk files should also be removed from DB.
4. After apply, reconnect client or run `Force Sync Now` and verify target files appear.

### Troubleshooting

- `.env not found`:
  - Create `obsidian-sync-server/.env` from `.env.example`.
- No files reconciled:
  - Verify `STORAGE_PATH` points to the actual server storage root.
- File still not synced after reconcile:
  - Check vault ID/path mapping and rerun with `--vault <vaultId>`.
