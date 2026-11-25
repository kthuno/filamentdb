import { $, esc } from './core.js';
import { t, th } from './i18n.js';
import { PRINT_PRESETS } from './printer-definitions.js';
import { PrinterError, printerSupport, printErrorCode } from './printer-transport.js';
import { BluetoothTransport } from './printer-bluetooth.js';
import { USBTransport } from './printer-usb.js';
import { PrintJobs, validatePrintSettings } from './print-jobs.js';
import { DESIGN_LIMIT, importDesign, exportDesign, cloneDesign, newElement, spoolDesign } from './label-design.js';
import { createSpoolLabel, preferredLabelSize, readLabelTemplate, labelTemplateOrigin, restoreTemplateDesign } from './label-templates.js';
import { loadSharedLabelTemplates } from './label-template-store.js';
import { renderDesign } from './label-renderer.js';
import { monochromePixels, packRaster, previewPixels } from './label-raster.js';

function nativeKey(key) { return 'native.'+key; }
function nativeInput(name,type='number',attributes='') {
  return `<label>${th(nativeKey(name))}<input data-native-field="${name}" type="${type}" ${attributes}></label>`;
}
function nativeSelect(name,options) {
  return `<label>${th(nativeKey(name))}<select data-native-field="${name}">${options.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('')}</select></label>`;
}
function nativeButton(action,key=action,attributes='') { return `<button type="button" data-native-action="${action}" ${attributes}>${th(nativeKey(key))}</button>`; }

class NativePrintDialog {
  constructor() {
    this.root=$('#native-label-dialog');this.transport=null;this.connecting=false;this.previewVersion=0;this.ready=false;
    this.jobs=new PrintJobs({onState:()=>this.controls()});
    this.root.addEventListener('cancel',()=>this.endSession());
    this.root.addEventListener('close',()=>this.endSession());
    globalThis.window?.addEventListener('pagehide',()=>this.endSession());
  }
  find(name) { return this.root.querySelector('[data-native-field="'+name+'"]'); }
  action(name) { return this.root.querySelector('[data-native-action="'+name+'"]'); }
  message(key,values={}) { this.root.querySelector('[data-native-status]').textContent=t(nativeKey(key),values); }
  error(error) {
    const code=printErrorCode(error);
    this.root.querySelector('[data-native-error]').textContent=t(nativeKey('error_'+code),{variable:error.variable||''});
  }
  clearError() { this.root.querySelector('[data-native-error]').textContent=''; }
  text() { return {profile:t('native.profile'),nozzle:t('labels.nozzle'),bed:t('labels.bed'),drying:t('labels.drying'),flow:t('labels.flow'),spool:t('native.spool')}; }
  async open(spool,link,options) {
    if(this.jobs.busy || this.connecting)return;
    this.session=(this.session||0)+1;this.spool=spool;this.link=link;this.options=options;this.selected=0;
    this.sizeDrafts=new Map();const session=this.session;
    let templateLoadError=null;
    try {await loadSharedLabelTemplates();}catch(error){templateLoadError=error;}
    if(session!==this.session)return;this.templateFetchError=templateLoadError;
    this.loadSizeDesign(Object.hasOwn(PRINT_PRESETS,options.size)?options.size:preferredLabelSize());
    if(templateLoadError)this.templateProblem=templateLoadError;
    const content=`<div class="modal-heading"><h2 id="native-print-title">${th('native.title')}</h2>${nativeButton('close','close','class="icon-button"')}</div>
      <p>${th('native.help')}</p><p>${th('native.local_help')}</p>
      <div class="native-printer-bar">${nativeSelect('transport',[['bluetooth','Bluetooth'],['usb','USB']])}${nativeButton('connect')}${nativeButton('disconnect')}
      <p data-native-status role="status" aria-live="polite"></p></div>
      <p data-native-support role="status"></p><p data-native-template-status role="status"></p><p data-native-error role="alert"></p>
      <div class="native-print-workspace"><section class="native-design-settings"><fieldset data-native-editor><legend>${th('native.design')}</legend>
      ${nativeInput('name','text','maxlength="200"')}${nativeSelect('size',Object.keys(PRINT_PRESETS).map(key=>[key,key.replace('x',' × ')+' mm']))}
      ${nativeSelect('dither',[['threshold',t('native.threshold')],['floyd-steinberg','Floyd–Steinberg'],['atkinson','Atkinson'],['ordered',t('native.ordered')]])}
      <label>${th('native.element')}<select data-native-elements></select></label><div data-native-inspector></div>
      <div class="native-editor-actions">${nativeButton('add-text')}${nativeButton('add-shape')}${nativeButton('add-qr')}
      <label class="native-file-button">${th('native.add-image')}<input type="file" data-native-image accept="image/png,image/jpeg"></label>
      ${nativeButton('remove')}${nativeButton('forward')}${nativeButton('backward')}</div>
      </fieldset></section><section class="native-label-preview" aria-label="${th('native.preview')}"><canvas data-native-preview></canvas><p data-native-dimensions></p></section></div>
      <fieldset data-native-settings><legend>${th('native.print_settings')}</legend><div class="thermal-controls">
      ${nativeInput('copies','number','min="1" max="99" step="1"')}${nativeInput('density','number','min="1" max="8" step="1"')}${nativeInput('feed','number','min="0" max="255" step="1"')}
      </div></fieldset><p>${th('native.transfer_help')}</p>
      <div class="native-editor-actions"><label class="native-file-button">${th('native.import')}<input type="file" data-native-import accept=".json,application/json"></label>
      ${nativeButton('save')}${nativeButton('reset')}${nativeButton('json')}${nativeButton('png')}</div>
      <div class="modal-actions">${nativeButton('cancel')}${nativeButton('print','print','class="primary"')}</div>`;
    this.root.querySelector('#native-label-content').innerHTML=content;
    this.find('transport').value=printerSupport('bluetooth') && !printerSupport('usb')?'usb':'bluetooth';
    this.find('dither').value='threshold';
    let settings={copies:1,density:6,feed:32};
    try { settings=validatePrintSettings(JSON.parse(globalThis.localStorage?.getItem('filamentdb.print-settings')||'{}')); } catch {}
    for(const [key,value] of Object.entries(settings))this.find(key).value=value;
    this.find('name').value=this.design.name;this.setSize();this.listElements();this.bind();this.controls();
    this.message('disconnected');this.root.showModal();await this.refresh();
  }
  loadSizeDesign(size,restore=true) {
    this.templateProblem=this.templateFetchError||null;this.templateRecord=null;this.edited=false;
    try {
      const result=createSpoolLabel(this.spool,this.link,{...this.options,size},this.text());
      this.design=result.design;this.templateRecord=result.template;
      if(restore)try {
        const storage=globalThis.localStorage,key='filamentdb.label-design.'+this.spool.label_token;
        const json=storage?.getItem(key+'.'+size)||storage?.getItem(key);
        if(json) {
          const saved=importDesign(json),origin=saved.filamentdbTemplate;
          const matching=this.templateRecord?origin?.size===size && origin.revision===this.templateRecord.revision:!origin;
          if(saved.labelSize.width+'x'+saved.labelSize.height===size && matching){this.design=this.templateRecord?restoreTemplateDesign(saved,this.design):saved;this.edited=true;}
        }
      }catch {}
    }catch(error){this.templateProblem=error;this.design=spoolDesign(this.spool,this.link,{...this.options,size},this.text());}
  }
  setSize() {
    const size=this.design.labelSize.width+'x'+this.design.labelSize.height;this.find('size').value=size;
    this.root.querySelector('[data-native-template-status]').textContent=this.templateRecord?t('native.template_source',{name:this.templateRecord.design.name,size:size.replace('x',' × ')}):t('native.default_source');
    this.action('reset').textContent=t(this.templateRecord?'native.use_template':'native.reset');
  }
  listElements() {
    const list=this.root.querySelector('[data-native-elements]');
    list.innerHTML=this.design.elements.map((e,index)=>`<option value="${index}">${index+1}. ${th(nativeKey('type_'+e.type))}${e.type==='text'?' · '+esc(e.text.slice(0,35)):''}</option>`).join('');
    this.selected=Math.max(0,Math.min(this.selected,this.design.elements.length-1));list.value=String(this.selected);this.inspector();
  }
  inspector() {
    const element=this.design.elements[this.selected],panel=this.root.querySelector('[data-native-inspector]');
    if(!element){panel.innerHTML='';return;}
    panel.innerHTML=`<div class="native-geometry">${['x','y','width','height','rotation'].map(key=>nativeInput(key,'number','step="1"')).join('')}</div>`+
      (element.type==='text'?`<label>${th('native.text')}<textarea data-native-field="text" rows="3" maxlength="5000"></textarea></label>${nativeInput('fontSize','number','min="1" max="200"')}${nativeSelect('align',['left','center','right'].map(key=>[key,t(nativeKey(key))]))}${nativeSelect('fontWeight',[['normal',t('native.normal')],['bold',t('native.bold')]])}`:'')+
      (element.type==='qr'?nativeInput('qrData','text','maxlength="2953"')+nativeSelect('finderStyle',[['square',t('native.finder_square')],['round-top-left',t('native.finder_round')]]):'')+
      (element.type==='shape'?`${nativeSelect('shapeType',['rectangle','ellipse','triangle','line'].map(key=>[key,t(nativeKey(key))]))}${nativeSelect('fill',[['black',t('native.black')],['white',t('native.white')],['none',t('native.none')]])}${nativeSelect('stroke',[['black',t('native.black')],['white',t('native.white')],['none',t('native.none')]])}${nativeInput('strokeWidth','number','min="0" max="100"')}`:'');
    for(const input of panel.querySelectorAll('[data-native-field]'))input.value=element[input.dataset.nativeField] ?? (input.dataset.nativeField==='rotation'?0:input.dataset.nativeField==='finderStyle'?'square':'');
  }
  bind() {
    this.root.oninput=event=>{
      const key=event.target.dataset.nativeField;
      if(!key)return;
      if(['copies','density','feed'].includes(key)){this.controls();return;}
      if(['transport','size','dither'].includes(key))return;
      this.edited=true;
      if(key==='name')this.design.name=event.target.value;
      else {
        const element=this.design.elements[this.selected];if(!element)return;
        element[key]=['x','y','width','height','rotation','fontSize','strokeWidth'].includes(key)?(event.target.value===''?NaN:Number(event.target.value)):event.target.value;
      }
      this.refresh();
    };
    this.root.onchange=event=>{
      if(event.target.matches('[data-native-elements]')){this.selected=Number(event.target.value);this.inspector();return;}
      if(event.target===this.find('size')) {
        try {
          const size=event.target.value,current=this.design.labelSize.width+'x'+this.design.labelSize.height;
          this.sizeDrafts.set(current,{design:JSON.parse(JSON.stringify(this.design)),edited:this.edited,templateRecord:this.templateRecord,templateProblem:this.templateProblem});
          const draft=this.sizeDrafts.get(size);
          if(draft){this.design=draft.design;this.edited=draft.edited;this.templateRecord=draft.templateRecord;this.templateProblem=draft.templateProblem;}
          else this.loadSizeDesign(size);
          try {globalThis.localStorage?.setItem('filamentdb.native-label-size',size);}catch {}
          this.find('name').value=this.design.name;this.selected=0;this.setSize();this.listElements();this.refresh();
        }catch(error){this.error(error);}
      }
      if(event.target===this.find('dither'))this.refresh();
      if(event.target===this.find('transport')){this.clearError();this.message('disconnected');this.controls();}
      if(event.target.matches('[data-native-import]'))this.importFile(event.target.files?.[0]);
      if(event.target.matches('[data-native-image]'))this.addImage(event.target.files?.[0]);
    };
    this.root.onclick=event=>{
      const button=event.target.closest('[data-native-action]');if(!button || button.disabled)return;
      this.perform(button.dataset.nativeAction).catch(error=>this.error(error));
    };
    this.root.querySelector('[data-native-preview]').onclick=event=>{
      if(this.jobs.busy)return;
      const rect=event.target.getBoundingClientRect(),x=(event.clientX-rect.left)*event.target.width/rect.width,y=(event.clientY-rect.top)*event.target.height/rect.height;
      for(let i=this.design.elements.length-1;i>=0;i--) {
        const e=this.design.elements[i],angle=-(e.rotation||0)*Math.PI/180,dx=x-e.x-e.width/2,dy=y-e.y-e.height/2;
        if(Math.abs(dx*Math.cos(angle)-dy*Math.sin(angle))<=e.width/2 && Math.abs(dx*Math.sin(angle)+dy*Math.cos(angle))<=e.height/2){this.selected=i;this.root.querySelector('[data-native-elements]').value=i;this.inspector();break;}
      }
    };
  }
  controls() {
    if(!this.design)return;
    const busy=this.jobs.busy,locked=busy||this.connecting,connected=Boolean(this.transport?.connected);
    this.root.querySelector('[data-native-editor]').disabled=locked;this.root.querySelector('[data-native-settings]').disabled=locked;
    this.find('transport').disabled=locked||connected;
    const reason=printerSupport(this.find('transport').value);
    this.root.querySelector('[data-native-support]').textContent=reason?t(nativeKey('error_'+reason)):t('native.select_m220');
    let valid=true;try {validatePrintSettings(this.settings());}catch {valid=false;}
    this.action('connect').disabled=locked||connected||Boolean(reason);
    this.action('disconnect').disabled=!connected||locked;
    this.action('print').disabled=locked||!connected||!this.ready||!valid;
    this.action('cancel').disabled=!locked;
    for(const key of ['json','png','save'])this.action(key).disabled=locked||!this.ready;
    for(const key of ['reset'])this.action(key).disabled=locked;
    for(const input of this.root.querySelectorAll('[data-native-import],[data-native-image]'))input.disabled=locked;
  }
  settings() { return Object.fromEntries(['copies','density','feed'].map(key=>[key,Number(this.find(key).value)])); }
  nextId() {
    let id;
    do {this.elementSerial=(this.elementSerial||0)+1;id='native-'+Date.now()+'-'+this.elementSerial;}
    while(this.design.elements.some(element=>element.id===id));
    return id;
  }
  async refresh() {
    const version=++this.previewVersion;this.ready=false;this.raster=null;this.clearError();this.controls();
    const preview=this.root.querySelector('[data-native-preview]');preview.getContext('2d')?.clearRect?.(0,0,preview.width,preview.height);
    try {
      if(this.templateProblem)throw this.templateProblem;
      const design=cloneDesign(this.design),mode=this.find('dither').value;
      if(globalThis.document.fonts?.ready)await document.fonts.ready;
      const rendered=await renderDesign(design);
      if(version!==this.previewVersion || !this.root.open)return;
      const dots=monochromePixels(rendered.pixels,rendered.width,rendered.height,mode,rendered.qrRegions);
      const canvas=this.root.querySelector('[data-native-preview]');canvas.width=rendered.width;canvas.height=rendered.height;
      const ctx=canvas.getContext('2d'),image=ctx.createImageData(rendered.width,rendered.height);image.data.set(previewPixels(dots));ctx.putImageData(image,0,0);
      this.raster=packRaster(dots,rendered.width,rendered.height);this.ready=true;
      this.root.querySelector('[data-native-dimensions]').textContent=t('native.dimensions',{width:rendered.width,height:rendered.height});
    } catch(error) { if(version===this.previewVersion)this.error(error instanceof PrinterError?error:new PrinterError('invalid_image')); }
    finally { if(version===this.previewVersion)this.controls(); }
  }
  async perform(action) {
    if(action==='close'){this.root.close();return;}
    if(action==='cancel'){await this.endSession();this.message('cancelled');this.controls();return;}
    this.clearError();
    if(action==='connect') {
      this.connecting=true;
      const onDisconnect=()=>{this.jobs.cancel();this.message('disconnected');this.controls();};
      this.transport=this.find('transport').value==='usb'?new USBTransport({onDisconnect}):new BluetoothTransport({onDisconnect});
      this.message('connecting');this.controls();
      try {await this.transport.connect();this.message('connected',{name:this.transport.name});}
      catch(error) {this.message('disconnected');throw error;}
      finally {this.connecting=false;this.controls();}
      return;
    }
    if(action==='disconnect'){await this.endSession();this.message('disconnected');this.controls();return;}
    if(action==='print') {
      const settings=validatePrintSettings(this.settings());
      try { globalThis.localStorage?.setItem('filamentdb.print-settings',JSON.stringify(settings)); } catch {}
      this.message('sending',{copy:1,copies:settings.copies,percent:0});
      try { await this.jobs.run(this.transport,this.raster,settings,progress=>this.message('sending',progress));this.message('sent'); }
      finally {this.controls();}
      return;
    }
    if(action==='save') {
      try {
        if(!globalThis.localStorage)throw new Error();
        const size=this.design.labelSize.width+'x'+this.design.labelSize.height;
        if(this.templateRecord)this.design.filamentdbTemplate=labelTemplateOrigin(this.templateRecord,this.spool,this.link,this.options);else delete this.design.filamentdbTemplate;
        globalThis.localStorage.setItem('filamentdb.label-design.'+this.spool.label_token+'.'+size,exportDesign(this.design));this.message('saved');
      }
      catch {throw new PrinterError('storage_failed');}
      return;
    }
    if(action==='reset') {
      this.loadSizeDesign(this.find('size').value,false);this.selected=0;
      this.find('name').value=this.design.name;this.setSize();this.listElements();await this.refresh();return;
    }
    if(action==='json'){this.download(new Blob([exportDesign(this.design)],{type:'application/json'}),'json');return;}
    if(action==='png') {
      const canvas=this.root.querySelector('[data-native-preview]');
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw new PrinterError('invalid_image');this.download(blob,'png');return;
    }
    this.edited=true;
    if(action.startsWith('add-')) {
      const type=action.slice(4),element=newElement(type,this.nextId());
      if(type==='qr')element.qrData=this.link;
      if(type==='text')element.text=t('native.new_text');
      this.design.elements.push(element);this.selected=this.design.elements.length-1;
    }
    if(action==='remove')this.design.elements.splice(this.selected,1);
    if(action==='forward' || action==='backward') {
      const next=this.selected+(action==='forward'?1:-1);
      if(next>=0 && next<this.design.elements.length){[this.design.elements[this.selected],this.design.elements[next]]=[this.design.elements[next],this.design.elements[this.selected]];this.selected=next;}
    }
    this.listElements();await this.refresh();
  }
  download(blob,extension) {
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;
    anchor.download=(this.design.name.replace(/[^\p{L}\p{N}_.-]+/gu,'-').slice(0,100)||'filament-label')+'.'+extension;
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async importFile(file) {
    if(!file)return;
    const session=this.session;
    try {
      if(file.size>DESIGN_LIMIT)throw new PrinterError('invalid_design');
      const design=importDesign(await file.text());
      if(session!==this.session||this.jobs.busy||this.connecting||!this.root.open)return;
      this.design=design;this.selected=0;this.edited=true;this.templateProblem=null;
      try {this.templateRecord=readLabelTemplate(design.labelSize.width+'x'+design.labelSize.height);}catch {this.templateRecord=null;}
      this.find('name').value=design.name;this.setSize();this.listElements();await this.refresh();this.message('imported');
    } catch(error) {if(session===this.session)this.error(error);}
  }
  async addImage(file) {
    if(!file)return;
    const session=this.session;
    try {
      if(file.size>500000 || !['image/png','image/jpeg'].includes(file.type))throw new PrinterError('invalid_image');
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      if(session!==this.session||this.jobs.busy||this.connecting||!this.root.open)return;
      const element=newElement('image',this.nextId());element.imageData=data;this.edited=true;
      this.design.elements.push(element);this.selected=this.design.elements.length-1;this.listElements();await this.refresh();
    } catch {if(session===this.session)this.error(new PrinterError('invalid_image'));}
  }
  async endSession() {
    ++this.previewVersion;this.jobs.cancel();
    try {await this.transport?.disconnect();}catch {}
  }
}
let nativeController=null;
export function openNativeLabelPrinter(spool,link,options={}) {
  nativeController ||= new NativePrintDialog();
  return nativeController.open(spool,link,options);
}
