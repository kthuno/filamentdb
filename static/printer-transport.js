// Transport contract: kind, connected, name, connect(), disconnect(), send(bytes).
// Protocol pacing belongs to the job, so transports only write exact byte buffers.
export class PrinterError extends Error {
  constructor(code) { super(code);this.code=code; }
}
export function printerSupport(kind, environment=globalThis) {
  if(!environment.isSecureContext)return 'secure_required';
  if(!environment.navigator?.[kind==='usb'?'usb':'bluetooth']?.requestDevice)return 'unsupported';
  return '';
}
export function checkConnection(transport) {
  if(!transport.connected)throw new PrinterError('disconnected');
}
export function printErrorCode(error) {
  if(error instanceof PrinterError)return error.code;
  return {NotFoundError:'cancelled',NotAllowedError:'permission_denied',SecurityError:'permission_denied',AbortError:'cancelled'}[error?.name] || 'connection_failed';
}
