# CARE — Content-Addressed Resource Exchange

Proof-of-concept app: upload a file, get it stored with a content-addressed
identifier (IPFS CID) and its SHA256 hash anchored to the Bitcoin blockchain
via OpenTimestamps. Records are stored locally in SQLite and files are
retrievable directly from the server.

## Stack

- **Backend**: Node 22, Express, Helia v5 (embedded IPFS node), better-sqlite3
- **Frontend**: React 18, Vite, Semantic UI React, react-dropzone
- **Timestamping**: OpenTimestamps (direct HTTP to calendar servers — no SDK)

## How It Works

1. You drop a file onto the UI
2. Backend computes SHA256, adds the file to the embedded Helia node (local blockstore only — not broadcast to the public IPFS network)
3. Hash is submitted to OpenTimestamps calendar servers (alice, bob, finney)
   for Bitcoin-anchored proof — best-effort, doesn't block storage
4. File hash, CID, timestamp, OTS receipt, and original filename stored in SQLite
5. File is retrievable via `/file/<cid>` on the same server

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/addfile` | Upload raw file bytes (`application/octet-stream`); optional `X-Filename` header preserves original filename. Returns `{ fileHash, cid, dateAdded, fileUrl, otsSubmitted }` |
| GET | `/getfile?hash=<sha256>` | Look up a file by SHA256; returns same fields + `unixTimeAdded` |
| GET | `/file/<cid>` | Download a file by its CID |

## Data

Stored in `./data/` (bind-mounted into container):
- `care.db` — SQLite (files table: file_hash, cid, date_added, ots_receipt, filename)
- `blocks/` — Helia blockstore
- `store/` — Helia datastore (DHT/routing state)

## Quick Start

```bash
# 1. Copy and edit environment variables
cp .env.example .env

# 2. Build and start
docker compose build
docker compose up -d

# 3. View logs
docker compose logs -f
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | Listen port |
| `DATA_DIR` | `/data` | Path to data directory inside the container |
| `CLIENT_URL` | `*` | CORS allowed origin — set to your domain in production |

## Deployment Options

### Standalone (no reverse proxy)

Edit `docker-compose.yml`: comment out the `networks:` block and uncomment
the `ports:` section:

```yaml
ports:
  - "3002:3002"
```

Then access the app at `http://localhost:3002` (or your server IP).

### Behind a reverse proxy (Caddy, nginx, etc.)

The default `docker-compose.yml` assumes a shared Docker network called `web`
that your reverse proxy also joins. Create it once if it doesn't exist:

```bash
docker network create web
```

Then point your proxy at `care:3002`. Example Caddy block:

```
care.example.com {
  handle {
    reverse_proxy care:3002
  }
}
```

No ports need to be exposed on the host in this mode.

## Note on IPFS

The embedded Helia node stores files locally and does not advertise to the
public IPFS network (no port 4001 exposed). Files are accessible via the
`/file/<cid>` endpoint on this server. The CID is still a valid
content-addressed identifier — anyone with the original file can verify it
matches by recomputing the SHA256/CID independently.
