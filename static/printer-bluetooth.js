// GATT discovery and characteristic selection adapted from Phomymo ble.js (MIT).
// Pinned source and changes: vendor/phomymo-NOTICE.txt.
import { M220 } from './printer-definitions.js';
import { PrinterError, printerSupport, checkConnection } from './printer-transport.js';

export class BluetoothTransport {
  constructor({environment=globalThis,onDisconnect=()=>{}}={}) {
    this.environment=environment;this.onDisconnect=onDisconnect;this.kind='bluetooth';
    this.connected=false;this.name='';this.generation=0;this.pending=false;
  }
  async connect() {
    const reason=printerSupport(this.kind,this.environment);
    if(reason)throw new PrinterError(reason);
    if(this.pending)throw new PrinterError('busy');
    if(this.connected)return;
    this.pending=true;const generation=++this.generation;
    let device;
    try {
      // No preceding await: permission must be requested from the user's click.
      device=await this.environment.navigator.bluetooth.requestDevice({filters:[{namePrefix:'M220'},{namePrefix:'Q'},{namePrefix:'Phomemo'}],optionalServices:[M220.bleService]});
      const current=()=>{if(generation!==this.generation)throw new PrinterError('cancelled');};
      current();this.device=device;
      const server=await device.gatt.connect();current();
      const service=await server.getPrimaryService(M220.bleService);current();
      const characteristic=await service.getCharacteristic(M220.bleWrite);current();
      const properties=characteristic.properties;
      this.withResponse=!properties.writeWithoutResponse;
      if(this.withResponse && !properties.write)throw new PrinterError('incompatible');
      this.writeMethod=this.withResponse
        ? (typeof characteristic.writeValueWithResponse==='function'?'writeValueWithResponse':'writeValue')
        : 'writeValueWithoutResponse';
      if(typeof characteristic[this.writeMethod]!=='function')throw new PrinterError('incompatible');
      this.characteristic=characteristic;this.name=device.name || M220.id;this.connected=true;
      this.listener=()=>{device.removeEventListener('gattserverdisconnected',this.listener);this.connected=false;this.characteristic=null;this.device=null;this.onDisconnect();};
      device.addEventListener('gattserverdisconnected',this.listener);
    } catch(error) {
      if(this.listener)device?.removeEventListener('gattserverdisconnected',this.listener);
      device?.gatt?.disconnect();this.connected=false;this.characteristic=null;this.device=null;
      throw error;
    } finally { this.pending=false; }
  }
  async disconnect() {
    ++this.generation;this.connected=false;
    if(this.listener)this.device?.removeEventListener('gattserverdisconnected',this.listener);
    this.device?.gatt?.disconnect();this.device=null;this.characteristic=null;
  }
  async send(bytes) {
    checkConnection(this);
    const data=new Uint8Array(bytes);
    await this.characteristic[this.writeMethod](data);
    // A rejected write is never retried; a prefix may already have reached the printer.
  }
}
