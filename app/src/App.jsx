import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Grid, Segment, Header, Form, List, Message, Icon, Tab
} from 'semantic-ui-react';
import WebService from './WebService';
import WebServiceErrorStatusesEnum from './WebServiceErrorStatusesEnum';

const webService = new WebService();

// ── Upload tab ────────────────────────────────────────────────────────────────

function UploadPane() {
  const [isLoading, setIsLoading]       = useState(false);
  const [isReaderError, setReaderError] = useState(false);
  const [errorStatus, setErrorStatus]   = useState(null);
  const [results, setResults]           = useState([]);

  const onDrop = useCallback((acceptedFiles) => {
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
        const response = await webService.addFileAsync(reader.result, file.name);

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

  return (
    <Segment basic loading={isLoading}>
      <Form error={errorStatus === WebServiceErrorStatusesEnum.DifferentAddError}>
        <Header color="teal" as="h2">Upload File to IPFS</Header>

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
  const [hash, setHash]               = useState('');
  const [errorStatus, setErrorStatus] = useState(null);
  const [fileInfo, setFileInfo]       = useState(null);

  const onSubmit = async () => {
    setIsLoading(true);
    setErrorStatus(null);
    setFileInfo(null);

    const response = await webService.getFileAsync(hash);

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
          action={{ disabled: !hash, icon: 'search' }}
          placeholder="Paste SHA256 hash…"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
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
          <Header color="green" as="h3">File found:</Header>
          <List relaxed>
            <List.Item>
              <List.Header>SHA256 Hash</List.Header>
              <List.Description>{fileInfo.hash}</List.Description>
            </List.Item>
            <List.Item>
              <List.Header>IPFS CID</List.Header>
              <List.Description>
                <a href={fileInfo.fileUrl} target="_blank" rel="noopener noreferrer">
                  {fileInfo.cid}
                </a>
              </List.Description>
            </List.Item>
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
          </List>
        </Segment>
      )}
    </Segment>
  );
}

// ── App root ──────────────────────────────────────────────────────────────────

const panes = [
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
