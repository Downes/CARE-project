// Simple error type constants replacing the deprecated enumify dependency
const WebServiceErrorStatusesEnum = Object.freeze({
  FileNotExist:      'FileNotExist',
  FileAlreadyExists: 'FileAlreadyExists',
  DifferentAddError: 'DifferentAddError',
  DifferentGetError: 'DifferentGetError',
});

export default WebServiceErrorStatusesEnum;