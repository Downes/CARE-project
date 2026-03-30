# CARE — Content-Addressed Resource Exchange

## Overview
Proof-of-concept app: users upload files to IPFS via an embedded Helia node. Each file's SHA256 hash is submitted to OpenTimestamps calendar servers for Bitcoin-anchored timestamping. Records are stored locally in SQLite.

## Stack
- **Backend**: Node 22, Express, Helia v5 (embedded IPFS), better-sqlite3
- **Frontend**: React 18, Vite, Semantic UI React v2, react-dropzone v14
- **Timestamping**: OpenTimestamps (HTTP API, no SDK dependency)
- **Container**: `care:3002` (single container, serves both API and static frontend)

## Container & Ports
- Container name: `care`
- Internal port: `3002`
- No direct external port — routed via Caddy
- Domain: `care.mooc.ca`

## Data Persistence
- Volume: `./data` → `/data` in container
- `/data/care.db` — SQLite database (files table: file_hash, cid, date_added, ots_receipt)
- `/data/blocks/` — Helia blockstore (IPFS block storage)
- `/data/store/` — Helia datastore (DHT/routing state)

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/addfile` | Upload file bytes; returns `{ fileHash, cid, dateAdded, ipfsUrl, otsSubmitted }` |
| GET | `/getfile?hash=<sha256>` | Look up file by SHA256; returns same fields + `unixTimeAdded` |

## Building & Running
```bash
# First time / after code changes
docker compose build
docker compose up -d

# View logs
docker compose logs -f
```

## Environment Variables (.env)
Copy `.env.example` to `.env`:
- `PORT` — listen port (default 3002)
- `DATA_DIR` — path to data directory (default /data)
- `CLIENT_URL` — CORS origin (default *)

## Old Files (safe to remove)
The following are from the original 2018 Truffle/Ethereum version and are no longer used:
- `contracts/` — Solidity smart contracts
- `migrations/` — Truffle migration scripts
- `build/contracts/` — compiled contract artefacts
- `truffle-config.js` — Truffle configuration
- `services/` — old web3/Ganache service modules
- `test/` — old Truffle tests
- `app/build/` — old CRA build output (replaced by `app/dist/`)
