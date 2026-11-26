import { t } from './i18n.js';
import { PrinterError } from './printer-transport.js';
import { DESIGN_LIMIT } from './label-design.js';

// Only design documents cross the opaque-origin sandbox boundary. Printer
// connections and database writes always remain in the host application.
export class PhomymoDesigner {
  constructor(frame,{design,validate,onChange=()=>{},onError=()=>{},onReady=()=>{}}) {
    this.frame=frame;this.design=JSON.parse(JSON.stringify(design));this.validate=validate;
    this.onChange=onChange;this.onError=onError;this.onReady=onReady;this.ready=false;this.disposed=false;
    this.session=Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');this.requests=new Map();this.serial=0;
    this.listener=event=>this.receive(event);window.addEventListener('message',this.listener);
    this.loadTimer=setTimeout(()=>{if(!this.ready&&!this.disposed)this.onError(new PrinterError('designer_failed'));},20000);
    frame.src='/vendor/phomymo/index.html';
  }
  send(type,extra={}) {this.frame.contentWindow?.postMessage({channel:'filamentdb-designer',session:this.session,type,...extra},'*');}
  receive(event) {
    const message=event.data;
    if(this.disposed||event.source!==this.frame.contentWindow||event.origin!=='null'||!message||message.channel!=='filamentdb-designer')return;
    if(message.type==='ready'){this.send('initialize',{design:this.design});return;}
    if(message.session!==this.session)return;
    if(message.type==='loaded'){clearTimeout(this.loadTimer);this.ready=true;this.onReady();return;}
    if(!this.ready||!['changed','snapshot'].includes(message.type))return;
    try {
      const json=JSON.stringify(message.design);
      if(json.length>DESIGN_LIMIT)throw new PrinterError('invalid_design');
      const design=this.validate(json);
      if(design.labelSize.width!==this.design.labelSize.width||design.labelSize.height!==this.design.labelSize.height)throw new PrinterError('invalid_design');
      this.design=JSON.parse(JSON.stringify(design));
      if(message.type==='changed')this.onChange(this.design);
      else {
        const request=this.requests.get(message.request);if(!request)return;
        this.requests.delete(message.request);clearTimeout(request.timer);request.resolve(this.design);
      }
    }catch(error){
      const request=this.requests.get(message.request);
      if(request){this.requests.delete(message.request);clearTimeout(request.timer);request.reject(error);}
      this.onError(error);
    }
  }
  replace(design) {this.design=JSON.parse(JSON.stringify(design));if(this.ready)this.send('replace',{design:this.design});}
  insert(variable) {if(this.ready)this.send('insert-variable',{variable});}
  snapshot() {
    if(!this.ready||this.disposed)return Promise.reject(new PrinterError('designer_failed'));
    return new Promise((resolve,reject)=>{
      const request=++this.serial,timer=setTimeout(()=>{this.requests.delete(request);reject(new PrinterError('designer_failed'));},5000);
      this.requests.set(request,{resolve,reject,timer});this.send('snapshot',{request});
    });
  }
  dispose() {
    this.disposed=true;this.ready=false;clearTimeout(this.loadTimer);window.removeEventListener('message',this.listener);
    for(const request of this.requests.values()){clearTimeout(request.timer);request.reject(new PrinterError('cancelled'));}this.requests.clear();
    this.frame.removeAttribute('src');
  }
}
export function designerFrameHTML() {
  return `<iframe class="phomymo-designer-frame" data-phomymo-designer title="${t('designer.frame_title')}" sandbox="allow-scripts allow-downloads" referrerpolicy="no-referrer"></iframe>`;
}
