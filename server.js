import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createHelia, libp2pDefaults } from 'helia';
import { createLibp2p } from 'libp2p';
import { unixfs } from '@helia/unixfs';
import { FsBlockstore } from 'blockstore-fs';
import { FsDatastore } from 'datastore-fs';
import { CID } from 'multiformats/cid';
import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR    = process.env.DATA_DIR    || join(__dirname, 'data');
const PORT        = process.env.PORT        || 3002;
const CLIENT_URL  = process.env.CLIENT_URL  || '*';
// Set IPFS_ANNOUNCE_IP to your server's public IP to join the IPFS network.
// Leave unset (default) for hermit mode — files stored locally only.
const IPFS_ANNOUNCE_IP = process.env.IPFS_ANNOUNCE_IP || null;
const IPFS_PORT        = process.env.IPFS_PORT        || '4001';
const KVSTORE_URL      = process.env.KVSTORE_URL      || 'http://kvstore:5000';

// Token verification — JWTs verified locally via JWKS; opaque tokens via kvstore callback
const tokenCache = new Map();
const CACHE_TTL  = 5 * 60 * 1000;

// Per-issuer JWKS fetchers (jose caches the fetched keys internally)
const jwksCache = new Map();
function getJwks(issuerUrl) {
  if (!jwksCache.has(issuerUrl)) {
    jwksCache.set(issuerUrl, createRemoteJWKSet(new URL(`${issuerUrl}/.well-known/jwks.json`)));
  }
  return jwksCache.get(issuerUrl);
}

async function verifyToken(token) {
  const now = Date.now();
  const cached = tokenCache.get(token);
  if (cached && cached > now) return true;

  if (token.split('.').length === 3) {
    // JWT — decode issuer without verification, then verify signature via JWKS
    try {
      const [, payloadB64] = token.split('.');
      const { iss } = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      if (!iss) return false;
      await jwtVerify(token, getJwks(iss), { issuer: iss });
      tokenCache.set(token, now + CACHE_TTL);
      return true;
    } catch (err) {
      console.warn('JWT verify failed:', err.message);
      return false;
    }
  }

  // Opaque token fallback — for sessions predating JWT migration
  try {
    const res = await fetch(`${KVSTORE_URL}/auth/verify`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) { tokenCache.set(token, now + CACHE_TTL); return true; }
  } catch (err) {
    console.warn('kvstore verify error:', err.message);
  }
  tokenCache.delete(token);
  return false;
}

function requireAuth(req, res, next) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  verifyToken(token).then(valid => {
    if (valid) return next();
    res.status(401).json({ error: 'Invalid or expired token' });
  }).catch(() => res.status(503).json({ error: 'Auth service unavailable' }));
}

// Ensure data directories exist
mkdirSync(join(DATA_DIR, 'blocks'), { recursive: true });
mkdirSync(join(DATA_DIR, 'store'), { recursive: true });

// SQLite — stores file hash, IPFS CID, timestamp, and OTS receipt
const db = new Database(join(DATA_DIR, 'care.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_hash   TEXT    UNIQUE NOT NULL,
    cid         TEXT    NOT NULL,
    date_added  INTEGER NOT NULL,
    ots_receipt BLOB,
    filename    TEXT
  )
`);
// Add filename column to existing databases that predate this field
try { db.exec('ALTER TABLE files ADD COLUMN filename TEXT'); } catch {}

const stmtInsert = db.prepare(
  'INSERT INTO files (file_hash, cid, date_added, ots_receipt, filename) VALUES (?, ?, ?, ?, ?)'
);
const stmtFindByHash     = db.prepare('SELECT * FROM files WHERE file_hash = ?');
const stmtFindByCid      = db.prepare('SELECT * FROM files WHERE cid = ?');
const stmtFindByFilename = db.prepare('SELECT * FROM files WHERE filename LIKE ? ORDER BY date_added DESC LIMIT 1');
const stmtListFiles      = db.prepare('SELECT * FROM files ORDER BY date_added DESC');

// Helia IPFS node with persistent FS-backed stores
const blockstore = new FsBlockstore(join(DATA_DIR, 'blocks'));
const datastore  = new FsDatastore(join(DATA_DIR, 'store'));

// If IPFS_ANNOUNCE_IP is set, build a libp2p instance that listens on
// IPFS_PORT and announces the public IP to the DHT — full network mode.
// Otherwise use Helia's defaults (hermit mode — local storage only).
let libp2p;
if (IPFS_ANNOUNCE_IP) {
  const defaults = libp2pDefaults();
  libp2p = await createLibp2p({
    ...defaults,
    addresses: {
      listen:   defaults.addresses.listen.map(a =>
        a === '/ip4/0.0.0.0/tcp/0' ? `/ip4/0.0.0.0/tcp/${IPFS_PORT}` : a
      ),
      announce: [`/ip4/${IPFS_ANNOUNCE_IP}/tcp/${IPFS_PORT}`],
    },
  });
  console.log(`Helia running in network mode — announcing /ip4/${IPFS_ANNOUNCE_IP}/tcp/${IPFS_PORT}`);
} else {
  console.log('Helia running in hermit mode — local storage only');
}

const helia = await createHelia({ blockstore, datastore, ...(libp2p ? { libp2p } : {}) });
const heliaFs = unixfs(helia);
console.log(`Helia IPFS node started. Peer ID: ${helia.libp2p.peerId}`);

// Submit SHA256 digest to OpenTimestamps calendar servers
// Returns the raw OTS receipt bytes, or null if all calendars fail
async function submitToOpenTimestamps(hashHex) {
  const calendars = [
    'https://alice.btc.calendar.opentimestamps.org',
    'https://bob.btc.calendar.opentimestamps.org',
    'https://finney.calendar.opentimestamps.org',
  ];
  const hashBytes = Buffer.from(hashHex, 'hex');
  for (const calendar of calendars) {
    try {
      const response = await fetch(`${calendar}/digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: hashBytes,
      });
      if (response.ok) {
        const receipt = await response.arrayBuffer();
        console.log(`OTS receipt obtained from ${calendar}`);
        return Buffer.from(receipt);
      }
    } catch (err) {
      console.warn(`OTS calendar ${calendar} failed: ${err.message}`);
    }
  }
  console.warn('All OTS calendars failed — file stored without timestamp proof');
  return null;
}

const app = express();

// Serve the built React frontend
app.use(express.static(join(__dirname, 'app', 'dist')));

app.use(express.raw({ limit: '50mb', type: 'application/octet-stream' }));
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CLIENT_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Upload a file: add to IPFS, hash it, submit to OTS, store record
app.post('/addfile', requireAuth, async (req, res) => {
  try {
    const fileData = req.body;
    if (!fileData || !fileData.length) {
      return res.status(400).json({ error: 'No file data received' });
    }

    // Compute SHA256 of the raw file bytes
    const fileHash = createHash('sha256').update(fileData).digest('hex');

    // Reject duplicates
    const existing = stmtFindByHash.get(fileHash);
    if (existing) {
      return res.status(409).json({ error: 'File already exists', cid: existing.cid });
    }

    // Add to IPFS via Helia — returns a CID object
    const cid = await heliaFs.addBytes(fileData);
    const cidStr = cid.toString();
    const dateAdded = Math.floor(Date.now() / 1000);

    // Submit hash to OpenTimestamps (best-effort — doesn't block storage)
    const otsReceipt = await submitToOpenTimestamps(fileHash);

    const filename = req.headers['x-filename'] || null;
    stmtInsert.run(fileHash, cidStr, dateAdded, otsReceipt, filename);

    console.log(`Stored: CID=${cidStr}  hash=${fileHash}  ots=${!!otsReceipt}`);
    res.json({
      fileHash,
      cid: cidStr,
      dateAdded,
      fileUrl: `/file/${cidStr}`,
      otsSubmitted: !!otsReceipt,
    });
  } catch (err) {
    console.error('Error in /addfile:', err);
    res.status(500).json({ error: err.message });
  }
});

// Look up a file by SHA256 hash, CID, or filename fragment
const SHA256_RE = /^[0-9a-f]{64}$/i;
const CID_RE    = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;

app.get('/getfile', (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q parameter required' });

  let record;
  if (SHA256_RE.test(q))     record = stmtFindByHash.get(q.toLowerCase());
  else if (CID_RE.test(q))   record = stmtFindByCid.get(q);
  else                       record = stmtFindByFilename.get(`%${q}%`);

  if (!record) return res.status(404).json({ error: 'Not found' });

  res.json({
    hash:          record.file_hash,
    cid:           record.cid,
    filename:      record.filename || null,
    unixTimeAdded: record.date_added,
    exists:        true,
    fileUrl:       `/file/${record.cid}`,
    otsSubmitted:  !!record.ots_receipt,
  });
});

// List all stored files, newest first
app.get('/files', (req, res) => {
  const rows = stmtListFiles.all();
  res.json(rows.map(r => ({
    hash:         r.file_hash,
    cid:          r.cid,
    filename:     r.filename || null,
    fileUrl:      `/file/${r.cid}`,
    unixTimeAdded: r.date_added,
    otsSubmitted: !!r.ots_receipt,
  })));
});

// Download a file by CID — streams bytes from local Helia blockstore
app.get('/file/:cid', async (req, res) => {
  const { cid: cidStr } = req.params;

  const record = stmtFindByCid.get(cidStr);
  if (!record) return res.status(404).send('Not found');

  try {
    const cid = CID.parse(cidStr);
    const filename = (record.filename || cidStr).replace(/["\\\r\n]/g, '_');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Raw codec (0x55) blocks are plain bytes — read directly from blockstore.
    // UnixFS dag-pb (0x70) blocks go through the unixfs cat interface.
    if (cid.code === 0x55) {
      const bytes = await helia.blockstore.get(cid);
      res.end(Buffer.from(bytes));
    } else {
      for await (const chunk of heliaFs.cat(cid)) {
        res.write(chunk);
      }
      res.end();
    }
  } catch (err) {
    console.error('Error in /file/:cid:', err);
    res.status(500).send(err.message);
  }
});

// Fall through to React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'app', 'dist', 'index.html'));
});

app.listen(PORT, () => console.log(`CARE server listening on port ${PORT}`));
