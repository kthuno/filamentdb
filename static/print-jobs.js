import { M220 } from './printer-definitions.js';
import { PrinterError, checkConnection } from './printer-transport.js';
import { printBLE, printUSB } from './printer-protocol-m220.js';

export function validatePrintSettings({copies=1,density=6,feed=32}={}) {
  if(!Number.isInteger(copies)||copies<1||copies>99 || !Number.isInteger(density)||density<1||density>8 || !Number.isInteger(feed)||feed<0||feed>255)throw new PrinterError('invalid_settings');
  return {copies,density,feed};
}
export class PrintJobs {
  constructor({delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=15000,onState=()=>{}}={}) {
    this.delay=delay;this.timeoutMs=timeoutMs;this.onState=onState;this.busy=false;this.cancelled=false;
  }
  cancel() { this.cancelled=true; }
  async run(transport,raster,settings={},onProgress=()=>{}) {
    if(this.busy)throw new PrinterError('busy');
    const {copies,density,feed}=validatePrintSettings(settings);
    if(!(raster.data instanceof Uint8Array)||raster.widthBytes!==M220.widthBytes || !Number.isInteger(raster.heightLines)||raster.heightLines<1||raster.heightLines>640 || raster.data.length!==raster.widthBytes*raster.heightLines)throw new PrinterError('invalid_image');
    checkConnection(transport);
    const data=new Uint8Array(raster.data); // Snapshot the submitted job.
    this.busy=true;this.cancelled=false;this.onState(true);
    const check=()=>{if(this.cancelled)throw new PrinterError('cancelled');checkConnection(transport);};
    const guarded={
      send:async bytes=>{
        check();let timer;
        try { await Promise.race([transport.send(bytes),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new PrinterError('timeout')),this.timeoutMs);})]);check(); }
        finally { clearTimeout(timer); }
      },
      delay:async ms=>{check();await this.delay(ms);check();},
    };
    try {
      for(let copy=0;copy<copies;copy++) {
        check();
        await (transport.kind==='usb'?printUSB:printBLE)(guarded,data,raster.widthBytes,raster.heightLines,density,feed,
          percent=>onProgress({copy:copy+1,copies,percent}));
      }
    } catch(error) {
      // Failed/cancelled jobs can leave a partial raster buffered. End this session.
      try { await transport.disconnect(); } catch {}
      throw error;
    } finally { this.busy=false;this.onState(false); }
  }
}
