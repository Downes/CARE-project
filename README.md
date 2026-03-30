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
| `IPFS_ANNOUNCE_IP` | _(unset)_ | Public IPv4 to announce to the IPFS DHT. Unset = hermit mode |
| `IPFS_PORT` | `4001` | libp2p TCP port (only used when `IPFS_ANNOUNCE_IP` is set) |

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
public IPFS network. Files are accessible via the `/file/<cid>` endpoint on
this server. The CID is still a valid content-addressed identifier — anyone
with the original file can verify it matches by recomputing the SHA256/CID
independently.

To make the node a full participant in the public IPFS network — so that
public gateways (e.g. `ipfs.io`) and other nodes can retrieve your files —
three things are needed:

1. **Set `IPFS_ANNOUNCE_IP`** in your `.env` to your server's public IPv4
   address. The server will announce this address to the IPFS DHT on startup
   so other nodes know how to reach it. Optionally set `IPFS_PORT` (default
   `4001`).

2. **Expose port 4001** on the host and forward it to the container. Uncomment
   the `ports:` block in `docker-compose.yml`:
   ```yaml
   ports:
     - "4001:4001"
     - "4001:4001/udp"
   ```

3. **Open the port in your firewall** (e.g. `ufw allow 4001`).

Once all three are in place, the node will join the DHT on startup and other
peers — including public gateways — will be able to fetch content by CID
directly from your server. Be aware that this increases bandwidth usage and
attack surface, and the node's peer ID and IP will be publicly indexed by DHT
crawlers within minutes.
