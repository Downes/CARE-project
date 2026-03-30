import express from 'express';
import { createHelia } from 'helia';
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
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
const PORT = process.env.PORT || 3002;
const CLIENT_URL = process.env.CLIENT_URL || '*';

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
const stmtFindByHash = db.prepare('SELECT * FROM files WHERE file_hash = ?');
const stmtFindByCid  = db.prepare('SELECT * FROM files WHERE cid = ?');

// Helia IPFS node with persistent FS-backed stores
const blockstore = new FsBlockstore(join(DATA_DIR, 'blocks'));
const datastore  = new FsDatastore(join(DATA_DIR, 'store'));
const helia = await createHelia({ blockstore, datastore });
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
app.post('/addfile', async (req, res) => {
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

// Look up a file by its SHA256 hash
app.get('/getfile', async (req, res) => {
  const { hash } = req.query;
  if (!hash) return res.status(400).json({ error: 'hash parameter required' });

  const record = stmtFindByHash.get(hash);
  if (!record) return res.status(404).json({ error: 'Not found' });

  res.json({
    hash:          record.file_hash,
    cid:           record.cid,
    unixTimeAdded: record.date_added,
    exists:        true,
    fileUrl:       `/file/${record.cid}`,
    otsSubmitted:  !!record.ots_receipt,
  });
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
