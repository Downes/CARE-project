import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Grid, Segment, Header, Form, List, Message, Icon, Tab, Button
} from 'semantic-ui-react';
import WebService from './WebService';
import WebServiceErrorStatusesEnum from './WebServiceErrorStatusesEnum';
import config from './config';

const webService = new WebService();

// ── Auth ──────────────────────────────────────────────────────────────────────

// Derive the authHash sent to kvstore: PBKDF2(password, username+"_auth", 100k, SHA-256)
// Server stores bcrypt(authHash) — the raw password never leaves the browser.
async function deriveAuthHash(password, username) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await window.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(username + '_auth'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const TOKEN_KEY   = 'care:access_token';
const TOKEN_EXP   = 'care:token_expires';
const USER_KEY    = 'care:username';
const KVSTORE_KEY = 'care:kvstore_url';

function loadStoredAuth() {
  const token      = localStorage.getItem(TOKEN_KEY);
  const expires    = localStorage.getItem(TOKEN_EXP);
  const username   = localStorage.getItem(USER_KEY);
  const kvstoreUrl = localStorage.getItem(KVSTORE_KEY) || config.kvstoreUrl;
  if (!token || !expires) return null;
  if (new Date(expires) < new Date()) { clearStoredAuth(); return null; }
  return { token, username, kvstoreUrl };
}

function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXP);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(KVSTORE_KEY);
}

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ onLogin }) {
  const [kvstoreUrl, setKvstoreUrl] = useState(
    () => localStorage.getItem(KVSTORE_KEY) || config.kvstoreUrl
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setLoading] = useState(false);
  const [error, setError]       = useState(null);

  const onSubmit = async () => {
    if (!username || !password) return;
    setLoading(true);
    setError(null);
    try {
      const authHash = await deriveAuthHash(password, username.toLowerCase());
      const res = await fetch(`${kvstoreUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.toLowerCase(), auth_hash: authHash }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? 'Invalid username or password.' : 'Login failed. Try again.');
        return;
      }
      const data = await res.json();
      localStorage.setItem(TOKEN_KEY,   data.token);
      localStorage.setItem(TOKEN_EXP,   data.expires);
      localStorage.setItem(USER_KEY,    data.username);
      localStorage.setItem(KVSTORE_KEY, kvstoreUrl);
      onLogin({ token: data.token, username: data.username, kvstoreUrl });
    } catch (err) {
      setError('Could not reach the identity server. Try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Segment raised>
      <Header color="teal" as="h3">Sign in to upload files</Header>
      <Form onSubmit={onSubmit} loading={isLoading} error={!!error}>
        <Form.Input
          label="Identity server"
          placeholder="https://kvstore.mooc.ca"
          value={kvstoreUrl}
          onChange={e => setKvstoreUrl(e.target.value)}
        />
        <Form.Input
          label="Username"
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
        />
        <Form.Input
          label="Password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <Message error content={error} />
        <Form.Button primary disabled={!username || !password}>Sign in</Form.Button>
      </Form>
      <p style={{marginTop:'1em',fontSize:'0.85em',color:'#888'}}>
        No account? Register at <a href="https://clist.mooc.ca" target="_blank" rel="noopener noreferrer">clist.mooc.ca</a> or your own identity server.
      </p>
    </Segment>
  );
}

// ── Upload tab ────────────────────────────────────────────────────────────────

function UploadPane() {
  const [auth, setAuth]                 = useState(() => loadStoredAuth());
  const [isLoading, setIsLoading]       = useState(false);
  const [isReaderError, setReaderError] = useState(false);
  const [errorStatus, setErrorStatus]   = useState(null);
  const [results, setResults]           = useState([]);

  const onLogout = () => { clearStoredAuth(); setAuth(null); setResults([]); };

  const onDrop = useCallback((acceptedFiles) => {
    if (!auth) return;
    acceptedFiles.forEach((file) => {
      setIsLoading(true);
      setErrorStatus(null);
      setReaderError(false);

      const reader = new FileReader();

      reader.onerror = () => {
        setIsLoading(false);
        setReaderError(true);
      };

      reader.onload = async () => {
        const response = await webService.addFileAsync(reader.result, file.name, auth.token);

        if (response === WebServiceErrorStatusesEnum.FileAlreadyExists) {
          setErrorStatus(WebServiceErrorStatusesEnum.FileAlreadyExists);
        } else if (
          response === WebServiceErrorStatusesEnum.DifferentAddError
        ) {
          setErrorStatus(WebServiceErrorStatusesEnum.DifferentAddError);
        } else {
          setResults((prev) => [
            ...prev,
            { fileName: file.name, fileHash: response.fileHash, cid: response.cid, fileUrl: response.fileUrl, otsSubmitted: response.otsSubmitted },
          ]);
        }
        setIsLoading(false);
      };

      reader.readAsArrayBuffer(file);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
  });

  if (!auth) return <LoginForm onLogin={setAuth} />;

  return (
    <Segment basic loading={isLoading}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <Header color="teal" as="h2" style={{margin:0}}>Upload File</Header>
        <span style={{fontSize:'0.9em',color:'#666'}}>
          Signed in as <strong>{auth.username}</strong>{' '}
          <Button size="mini" basic onClick={onLogout}>Sign out</Button>
        </span>
      </div>
      <Form error={errorStatus === WebServiceErrorStatusesEnum.DifferentAddError}>

        <div
          {...getRootProps()}
          className={`dropZone ${isDragActive ? 'dropZoneActive' : 'dropZoneIdle'}`}
        >
          <input {...getInputProps()} />
          <Segment basic textAlign="center">
            <Icon disabled name="file outline" size="massive" color="teal" />
            <Header as="h4">
              {isDragActive ? 'Drop the file here…' : 'Drag & drop a file, or click to select'}
            </Header>
          </Segment>
        </div>

        <Message
          error
          header="Upload Error"
          content="Something went wrong uploading the file."
        />
      </Form>

      {errorStatus === WebServiceErrorStatusesEnum.FileAlreadyExists && (
        <Segment raised>
          <Header color="orange" as="h3">File already exists in the store.</Header>
        </Segment>
      )}

      {isReaderError && (
        <Segment raised>
          <Header color="red" as="h3">Could not read the file.</Header>
        </Segment>
      )}

      {results.length > 0 && (
        <Segment raised>
          <Header color="green" as="h3">Uploaded successfully:</Header>
          <List ordered relaxed style={{ textAlign: 'left' }}>
            {results.map((r, i) => (
              <List.Item key={i}>
                <List.Header>{r.fileName}</List.Header>
                <List.Description>
                  <strong>SHA256:</strong> {r.fileHash}<br />
                  <strong>CID:</strong>{' '}
                  <a href={r.fileUrl} target="_blank" rel="noopener noreferrer">
                    {r.cid}
                  </a><br />
                  <strong>OpenTimestamps:</strong>{' '}
                  {r.otsSubmitted ? '✓ Receipt obtained' : '⚠ Submission failed (file is still on IPFS)'}
                </List.Description>
              </List.Item>
            ))}
          </List>
        </Segment>
      )}
    </Segment>
  );
}

// ── Search tab ────────────────────────────────────────────────────────────────

function SearchPane() {
  const [isLoading, setIsLoading]     = useState(false);
  const [query, setQuery]             = useState('');
  const [errorStatus, setErrorStatus] = useState(null);
  const [fileInfo, setFileInfo]       = useState(null);

  const onSubmit = async () => {
    setIsLoading(true);
    setErrorStatus(null);
    setFileInfo(null);

    const response = await webService.getFileAsync(query);

    if (
      response === WebServiceErrorStatusesEnum.FileNotExist ||
      response === WebServiceErrorStatusesEnum.DifferentGetError
    ) {
      setErrorStatus(response);
    } else {
      setFileInfo(response);
    }
    setIsLoading(false);
  };

  return (
    <Segment basic loading={isLoading}>
      <Header color="teal" as="h2">Look Up a File</Header>
      <Form
        onSubmit={onSubmit}
        error={errorStatus === WebServiceErrorStatusesEnum.DifferentGetError}
      >
        <Form.Input
          fluid
          action={{ disabled: !query, icon: 'search' }}
          placeholder="Search by filename, SHA256 hash, or CID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Message
          error
          header="Lookup Error"
          content="Something went wrong searching for the file."
        />
      </Form>

      {errorStatus === WebServiceErrorStatusesEnum.FileNotExist && (
        <Segment raised>
          <Header color="red" as="h3">No record found for that hash.</Header>
        </Segment>
      )}

      {fileInfo && (
        <Segment raised>
          <Header color="green" as="h3">
            <a href={fileInfo.fileUrl}>{fileInfo.filename || fileInfo.cid}</a>
          </Header>
          <List relaxed>
            <List.Item>
              <List.Header>Added</List.Header>
              <List.Description>{fileInfo.time}</List.Description>
            </List.Item>
            <List.Item>
              <List.Header>OpenTimestamps</List.Header>
              <List.Description>
                {fileInfo.otsSubmitted
                  ? '✓ Bitcoin-anchored timestamp receipt stored'
                  : '⚠ No timestamp receipt (OTS submission failed at upload time)'}
              </List.Description>
            </List.Item>
            <List.Item>
              <List.Header>SHA256</List.Header>
              <List.Description><code>{fileInfo.hash}</code></List.Description>
            </List.Item>
            <List.Item>
              <List.Header>CID <span style={{fontWeight:'normal',fontSize:'0.85em',color:'#888'}}>(content identifier — a hash of the file in IPFS format)</span></List.Header>
              <List.Description><code>{fileInfo.cid}</code></List.Description>
            </List.Item>
          </List>
        </Segment>
      )}
    </Segment>
  );
}

// ── Files tab ─────────────────────────────────────────────────────────────────

function FilesPane() {
  const [files, setFiles]       = useState([]);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    webService.getFilesAsync().then(data => {
      setFiles(data);
      setLoading(false);
    });
  }, []);

  return (
    <Segment basic loading={isLoading}>
      <Header color="teal" as="h2">Stored Files</Header>
      {!isLoading && files.length === 0 && (
        <p>No files stored yet.</p>
      )}
      {files.length > 0 && (
        <List divided relaxed style={{ textAlign: 'left' }}>
          {files.map((f, i) => (
            <List.Item key={i}>
              <List.Content>
                <List.Header>
                  <a href={f.fileUrl}>{f.filename || f.cid}</a>
                </List.Header>
                <List.Description>
                  {new Date(f.unixTimeAdded * 1000).toLocaleString()}{' '}
                  &mdash; {f.otsSubmitted ? '✓ Timestamped' : '⚠ No timestamp'}<br />
                  <span style={{color:'#555'}}>SHA256: </span><code style={{fontSize:'0.85em'}}>{f.hash}</code><br />
                  <span style={{color:'#555'}}>CID: </span><code style={{fontSize:'0.85em'}}>{f.cid}</code>
                  <span style={{color:'#aaa',fontSize:'0.8em'}}> (content identifier — a hash of the file in IPFS format)</span>
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
      )}
    </Segment>
  );
}

// ── App root ──────────────────────────────────────────────────────────────────

const panes = [
  {
    menuItem: { content: 'Files', icon: 'list', key: 'files' },
    render: () => <Tab.Pane className="tabPane"><FilesPane /></Tab.Pane>,
  },
  {
    menuItem: { content: 'Upload', icon: 'upload', key: 'upload' },
    render: () => <Tab.Pane className="tabPane"><UploadPane /></Tab.Pane>,
  },
  {
    menuItem: { content: 'Search', icon: 'search', key: 'search' },
    render: () => <Tab.Pane className="tabPane"><SearchPane /></Tab.Pane>,
  },
];

export default function App() {
  return (
    <div className="mainContent">
      <Grid style={{ width: '100%' }} textAlign="center">
        <Grid.Column style={{ maxWidth: 700, maxHeight: 800, overflowY: 'auto' }}>
          <Tab menu={{ secondary: true }} panes={panes} />
        </Grid.Column>
      </Grid>
    </div>
  );
}
