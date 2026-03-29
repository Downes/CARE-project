import config from './config';
import WebServiceErrorStatusesEnum from './WebServiceErrorStatusesEnum';

class IpfsFile {
  constructor({ hash, cid, time, exists, ipfsUrl, otsSubmitted }) {
    this.hash         = hash;
    this.cid          = cid;
    this.time         = time;
    this.exists       = exists;
    this.ipfsUrl      = ipfsUrl;
    this.otsSubmitted = otsSubmitted;
  }
}

class WebService {
  async getFileAsync(hash) {
    const response = await fetch(`${config.apiServerAddress}/getfile?hash=${encodeURIComponent(hash)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (response.status === 200) {
      const info = await response.json();
      return new IpfsFile({
        hash:         info.hash,
        cid:          info.cid,
        time:         new Date(info.unixTimeAdded * 1000).toLocaleString(),
        exists:       info.exists,
        ipfsUrl:      info.ipfsUrl,
        otsSubmitted: info.otsSubmitted,
      });
    } else if (response.status === 404) {
      return WebServiceErrorStatusesEnum.FileNotExist;
    } else {
      console.error('getfile error, status:', response.status);
      return WebServiceErrorStatusesEnum.DifferentGetError;
    }
  }

  async addFileAsync(file) {
    const response = await fetch(`${config.apiServerAddress}/addfile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
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