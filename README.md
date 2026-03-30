# CARE — Content-Addressed Resource Exchange

Proof-of-concept app: upload a file, get it pinned to IPFS and its SHA256 hash
anchored to the Bitcoin blockchain via OpenTimestamps. Records are stored locally
in SQLite.

## Stack

- **Backend**: Node 20, Express, Helia v5 (embedded IPFS node), better-sqlite3
- **Frontend**: React 18, Vite, Semantic UI React, react-dropzone
- **Timestamping**: OpenTimestamps (direct HTTP to calendar servers — no SDK)
- **Container**: `care:3002`, routed via Caddy

## How It Works

1. You drop a file onto the UI
2. Backend computes SHA256, adds the file to the embedded Helia IPFS node
3. Hash is submitted to OpenTimestamps calendar servers (alice, bob, finney)
   for Bitcoin-anchored proof — best-effort, doesn't block storage
4. File hash, IPFS CID, timestamp, and OTS receipt stored in SQLite

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/addfile` | Upload raw file bytes (`application/octet-stream`); returns `{ fileHash, cid, dateAdded, ipfsUrl, otsSubmitted }` |
| GET | `/getfile?hash=<sha256>` | Look up a file by SHA256; returns same fields + `unixTimeAdded` |

## Data

Stored in `./data/` (bind-mounted into container):
- `care.db` — SQLite (files table: file_hash, cid, date_added, ots_receipt)
- `blocks/` — Helia blockstore
- `store/` — Helia datastore (DHT/routing state)

## Running

```bash
# Build and start
docker compose build
docker compose up -d

# Logs
docker compose logs -f
```

## Environment Variables

Copy `.env.example` to `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | Listen port |
| `DATA_DIR` | `/data` | Path to data directory |
| `CLIENT_URL` | `*` | CORS allowed origin |

## Domain

Planned: `care.mooc.ca` (Caddy entry not yet configured)
