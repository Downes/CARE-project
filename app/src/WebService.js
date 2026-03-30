import config from './config';
import WebServiceErrorStatusesEnum from './WebServiceErrorStatusesEnum';

class IpfsFile {
  constructor({ hash, cid, filename, time, exists, fileUrl, otsSubmitted }) {
    this.hash         = hash;
    this.cid          = cid;
    this.filename     = filename;
    this.time         = time;
    this.exists       = exists;
    this.fileUrl      = fileUrl;
    this.otsSubmitted = otsSubmitted;
  }
}

class WebService {
  async getFileAsync(query) {
    const response = await fetch(`${config.apiServerAddress}/getfile?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (response.status === 200) {
      const info = await response.json();
      return new IpfsFile({
        hash:         info.hash,
        cid:          info.cid,
        filename:     info.filename,
        time:         new Date(info.unixTimeAdded * 1000).toLocaleString(),
        exists:       info.exists,
        fileUrl:      info.fileUrl,
        otsSubmitted: info.otsSubmitted,
      });
    } else if (response.status === 404) {
      return WebServiceErrorStatusesEnum.FileNotExist;
    } else {
      console.error('getfile error, status:', response.status);
      return WebServiceErrorStatusesEnum.DifferentGetError;
    }
  }

  async getFilesAsync() {
    const response = await fetch(`${config.apiServerAddress}/files`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (response.status === 200) return await response.json();
    console.error('getfiles error, status:', response.status);
    return [];
  }

  async addFileAsync(file, filename, token) {
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (filename) headers['X-Filename'] = filename;
    if (token)    headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${config.apiServerAddress}/addfile`, {
      method: 'POST',
      headers,
      body: file,
    });

    if (response.status === 200) {
      return await response.json();
    } else if (response.status === 409) {
      return WebServiceErrorStatusesEnum.FileAlreadyExists;
    } else {
      console.error('addfile error, status:', response.status);
      return WebServiceErrorStatusesEnum.DifferentAddError;
    }
  }
}

export default WebService;
export { IpfsFile };