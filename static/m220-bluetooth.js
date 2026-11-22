// Independent implementation of the M220 wire format documented by Phomymo.
// Reference: transcriptionstream/phomymo @ 1f58d3f0e7f941b9143277cda828380149e56855
// See docs/m220-bluetooth.md for protocol analysis and attribution; no upstream code is bundled.
const M220_WIDTH = 576;
const M220_ROW_BYTES = M220_WIDTH / 8;
class M220Error extends Error {
  constructor(code) { super(code); this.code=code; }
}
function validateRasterSize(width,height) {
  if(!Number.isInteger(width) || width<1 || width>M220_WIDTH || !Number.isInteger(height) || height<1 || height>1600)throw new M220Error('invalid_image');
}
function packM220Raster({data,width,height}) {
  validateRasterSize(width,height);
  if(data.length!==width*height*4)throw new M220Error('invalid_image');
  const raster=new Uint8Array(M220_ROW_BYTES*height);
  const offset=M220_WIDTH-width;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=(y*width+x)*4, alpha=data[i+3]/255;
    const brightness=(.299*data[i]+.587*data[i+1]+.114*data[i+2])*alpha+255*(1-alpha);
    if(brightness<160) {
      const column=offset+x;
      raster[y*M220_ROW_BYTES+(column>>3)]|=0x80>>(column%8);
    }
  }
  return {data:raster,widthBytes:M220_ROW_BYTES,heightLines:height};
}
async function rasterizeM220Label(label) {
  if(!label || typeof label.svg!=='string')throw new M220Error('invalid_image');
  validateRasterSize(label.width,label.height);
  const canvas=document.createElement('canvas');
  canvas.width=label.width; canvas.height=label.height;
  const context=canvas.getContext('2d');
  if(!context)throw new M220Error('invalid_image');
  const url=URL.createObjectURL(new Blob([label.svg],{type:'image/svg+xml;charset=utf-8'}));
  try {
    const image=new Image();
    await new Promise((resolve,reject)=>{
      image.onload=resolve; image.onerror=()=>reject(new M220Error('invalid_image')); image.src=url;
    });
    context.fillStyle='white';context.fillRect(0,0,label.width,label.height);
    context.drawImage(image,0,0,label.width,label.height);
    return packM220Raster(context.getImageData(0,0,label.width,label.height));
  } finally { URL.revokeObjectURL(url); }
}
function m220SupportReason() {
  if(globalThis.isSecureContext!==true)return 'secure_required';
  if(!globalThis.navigator?.bluetooth?.requestDevice)return 'unsupported';
  return null;
}
class M220Printer {
  constructor({bluetooth=globalThis.navigator?.bluetooth,secure=globalThis.isSecureContext===true,
    delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),rasterize=rasterizeM220Label,onState=()=>{}}={}) {
    this.bluetooth=bluetooth;this.secure=secure;this.delay=delay;this.rasterize=rasterize;this.onState=onState;
    this.device=null;this.characteristic=null;this.busy=false;this.epoch=0;this.disconnectHandler=null;
  }
  get connected() { return Boolean(this.device?.gatt?.connected && this.characteristic); }
  state() { return {connected:this.connected,busy:this.busy,name:this.device?.name || ''}; }
  emit() { this.onState(this.state()); }
  check(epoch) {
    if(epoch!==this.epoch || !this.connected)throw new M220Error('disconnected');
  }
  async connect() {
    if(this.busy)throw new M220Error('busy');
    if(this.connected)return;
    if(!this.secure)throw new M220Error('secure_required');
    if(!this.bluetooth?.requestDevice)throw new M220Error('unsupported');
    this.busy=true;
    const epoch=++this.epoch;
    this.emit();
    let device;
    try {
      // This call runs in the Connect click's user activation, before any await.
      device=await this.bluetooth.requestDevice({
        filters:[{namePrefix:'M220'},{namePrefix:'m220'},{namePrefix:'Phomemo'},{namePrefix:'Q'}],optionalServices:[0xff00],
      });
      if(epoch!==this.epoch)throw new M220Error('disconnected');
      // Newer M220 units may advertise a generic Q… name (upstream issue #14).
      // Connect M220 is an explicit model choice; the name cannot identify those units.
      if(!/^(?:m220|phomemo|q)/i.test(device.name || ''))throw new M220Error('wrong_device');
      this.device=device;
      this.disconnectHandler=()=>{if(this.device===device)this.disconnect();};
      device.addEventListener('gattserverdisconnected',this.disconnectHandler);
      const server=await device.gatt.connect();
      await this.delay(100);
      if(epoch!==this.epoch)throw new M220Error('disconnected');
      const service=await server.getPrimaryService(0xff00);
      const characteristic=await service.getCharacteristic(0xff02);
      if(epoch!==this.epoch || !device.gatt.connected)throw new M220Error('disconnected');
      if(!characteristic.properties.writeWithoutResponse && !characteristic.properties.write)throw new M220Error('incompatible');
      this.characteristic=characteristic;
    } catch(error) {
      this.disconnect();
      // A cancelled pending picker may resolve after the extension was disabled.
      if(device?.gatt?.connected)device.gatt.disconnect();
      if(error.name==='NotFoundError' && !device)throw new M220Error('cancelled');
      if(error instanceof M220Error)throw error;
      throw new M220Error(error.name==='SecurityError' ? 'permission_denied' : 'connection_failed');
    } finally { this.busy=false;this.emit(); }
  }
  disconnect() {
    ++this.epoch;
    const device=this.device;
    if(device && this.disconnectHandler)device.removeEventListener('gattserverdisconnected',this.disconnectHandler);
    this.device=null;this.characteristic=null;this.disconnectHandler=null;
    if(device?.gatt?.connected)device.gatt.disconnect();
    this.emit();
  }
  async write(bytes,epoch) {
    this.check(epoch);
    const characteristic=this.characteristic;
    let timer;
    const operation=characteristic.properties.writeWithoutResponse
      ? characteristic.writeValueWithoutResponse(bytes)
      : typeof characteristic.writeValueWithResponse==='function'
        ? characteristic.writeValueWithResponse(bytes) : characteristic.writeValue(bytes);
    try {
      await Promise.race([operation,new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new M220Error('timeout')),12000);
      })]);
      this.check(epoch);
    } finally { clearTimeout(timer); }
  }
  async print(label,{density=6,feed=32,chunkSize=128,onProgress=()=>{}}={}) {
    if(this.busy)throw new M220Error('busy');
    if(!this.connected)throw new M220Error('disconnected');
    if(!Number.isInteger(density) || density<1 || density>8 || !Number.isInteger(feed) || feed<0 || feed>255 || ![20,128].includes(chunkSize))throw new M220Error('invalid_settings');
    this.busy=true;this.emit();
    const epoch=this.epoch;
    try {
      const raster=await this.rasterize(label);
      this.check(epoch);
      if(raster.widthBytes!==M220_ROW_BYTES || !Number.isInteger(raster.heightLines) || raster.heightLines<1 || raster.heightLines>1600 || raster.data.length!==M220_ROW_BYTES*raster.heightLines)throw new M220Error('invalid_image');
      await this.write(new Uint8Array([0x1b,0x40]),epoch);
      await this.delay(100);
      const heat=[40,60,80,100,120,140,160,200][density-1];
      await this.write(new Uint8Array([0x1b,0x37,7,heat,2]),epoch);
      await this.delay(30);
      await this.write(new Uint8Array([0x1d,0x7c,density]),epoch);
      await this.delay(50);
      await this.write(new Uint8Array([0x1d,0x76,0x30,0,M220_ROW_BYTES,0,raster.heightLines&255,raster.heightLines>>8]),epoch);
      for(let offset=0;offset<raster.data.length;offset+=chunkSize) {
        await this.write(raster.data.slice(offset,offset+chunkSize),epoch);
        await this.delay(20);
        this.check(epoch);
        onProgress(Math.round(Math.min(offset+chunkSize,raster.data.length)/raster.data.length*100));
      }
      await this.delay(300);
      await this.write(new Uint8Array([0x1b,0x4a,feed]),epoch);
      await this.delay(800);
      this.check(epoch);
    } catch(error) {
      // Never replay data: a failed write may already have reached the printer.
      this.disconnect();
      throw error instanceof M220Error ? error : new M220Error('send_failed');
    } finally { this.busy=false;this.emit(); }
  }
}
export { M220_WIDTH, M220Printer, M220Error, m220SupportReason, packM220Raster, rasterizeM220Label };
