// Device open/claim/OUT transfer adapted from Phomymo usb.js (MIT).
// Pinned source and changes: vendor/phomymo-NOTICE.txt.
import { M220 } from './printer-definitions.js';
import { PrinterError, printerSupport, checkConnection } from './printer-transport.js';

export class USBTransport {
  constructor({environment=globalThis,onDisconnect=()=>{}}={}) {
    this.environment=environment;this.onDisconnect=onDisconnect;this.kind='usb';
    this.connected=false;this.name='';this.pending=false;this.generation=0;
  }
  async connect() {
    const reason=printerSupport(this.kind,this.environment);
    if(reason)throw new PrinterError(reason);
    if(this.pending)throw new PrinterError('busy');
    if(this.connected)return;
    this.pending=true;const generation=++this.generation;
    let device;
    try {
      device=await this.environment.navigator.usb.requestDevice({filters:[{vendorId:M220.usbVendor,productId:M220.usbProduct}]});
      const current=()=>{if(generation!==this.generation)throw new PrinterError('cancelled');};
      current();this.device=device;
      await device.open();current();
      if(!device.configuration){await device.selectConfiguration(1);current();}
      // Interface numbers need not equal array indexes; only use the selected alternate.
      const candidates=device.configuration.interfaces.flatMap(iface=>iface.alternates.map(alt=>({iface,alt})))
        .filter(({alt})=>alt.endpoints.some(ep=>ep.direction==='out' && ep.type==='bulk'));
      const chosen=candidates.find(({alt})=>alt.interfaceClass===7) || candidates.find(({alt})=>alt.interfaceClass===255) || candidates.find(({alt})=>alt.interfaceClass===10);
      if(!chosen)throw new PrinterError('incompatible');
      await device.claimInterface(chosen.iface.interfaceNumber);current();
      this.interfaceNumber=chosen.iface.interfaceNumber;
      if(chosen.iface.alternate.alternateSetting!==chosen.alt.alternateSetting){
        await device.selectAlternateInterface(this.interfaceNumber,chosen.alt.alternateSetting);current();
      }
      this.endpoint=chosen.alt.endpoints.find(ep=>ep.direction==='out' && ep.type==='bulk').endpointNumber;
      this.name=device.productName || M220.id;this.connected=true;
      this.listener=event=>{if(event.device===this.device){this.environment.navigator.usb.removeEventListener('disconnect',this.listener);this.connected=false;this.device=null;this.onDisconnect();}};
      this.environment.navigator.usb.addEventListener('disconnect',this.listener);
    } catch(error) {
      try { if(device?.opened)await device.close(); } catch {}
      this.connected=false;this.device=null;throw error;
    } finally { this.pending=false; }
  }
  async disconnect() {
    ++this.generation;this.connected=false;
    if(this.listener)this.environment.navigator.usb.removeEventListener('disconnect',this.listener);
    const device=this.device;this.device=null;
    if(device?.opened)await device.close();
  }
  async send(bytes) {
    checkConnection(this);
    const result=await this.device.transferOut(this.endpoint,new Uint8Array(bytes));
    if(result.status!=='ok' || result.bytesWritten!==bytes.length)throw new PrinterError('send_failed');
  }
}
