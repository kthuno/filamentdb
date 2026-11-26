const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {loadFrontend}=require('./frontend-loader.cjs');
const {templateAPI}=require('./template-api.cjs');
const embeddedTemplate={name:'Imported Phomymo design',version:3,labelSize:{width:70,height:80},elements:[
  {id:'image',type:'image',x:24,y:24,width:64,height:64,rotation:0,imageData:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII='},
  {id:'text',type:'text',x:102,y:24,width:434,height:64,rotation:0,text:'Imported brand',fontSize:48,fontFamily:'Arial, sans-serif',fontWeight:'bold',align:'left',verticalAlign:'middle',noWrap:true},
  {id:'line',type:'shape',x:24,y:102,width:512,height:3,shapeType:'rectangle',fill:'black',stroke:'none',strokeWidth:0},
  {id:'qr',type:'qr',x:366,y:446,width:168,height:168,qrData:'DEMO-0042'},
]};
const sampleDesign=variant=>{
  const design=JSON.parse(JSON.stringify(embeddedTemplate));
  if(variant==='text-only')design.elements=design.elements.filter(element=>element.type!=='image');
  return design;
};
const designModule=()=>import('../static/label-design.js');
const rasterModule=()=>import('../static/label-raster.js');
const jobsModule=()=>import('../static/print-jobs.js');

function recordingCanvas() {
  const calls=[];
  const context={measureText:text=>({width:text.length*12}),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(255)}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})};
  for(const method of ['save','restore','fillRect','translate','rotate','drawImage','fillText','beginPath','rect','clip','moveTo','lineTo','closePath','stroke','fill','ellipse','roundRect','putImageData'])context[method]=(...args)=>calls.push([method,...args]);
  return {calls,context,width:0,height:0,getContext:()=>context};
}

test('supported image/text designs round-trip without changing content, IDs, positions or embedded image',async()=>{
  const {importDesign,exportDesign,cloneDesign}=await designModule();
  for(const name of ['text-only','advanced']) {
    const source=sampleDesign(name),result=importDesign(JSON.stringify(source));
    assert.deepEqual(JSON.parse(exportDesign(result)),source);
    const originalX=source.elements[0].x,clone=cloneDesign(result);clone.elements[0].x=50;assert.equal(source.elements[0].x,originalX);
  }
});

test('native spool designs use exact preset dots, individual identity and live profile values without demo data',async()=>{
  const {spoolDesign,resizeDesign}=await designModule();
  const {renderDesign}=await import('../static/label-renderer.js');
  for(const size of ['40x30','60x40','70x80']) {
    const design=spoolDesign({id:15,name:'Real spool',material:'PLA',manufacturer:'Other',color:'Red',weight:1000,label_token:'unique'},'https://example.com/#spool/unique',{size,nozzle:'210°C'},{profile:'Profile',nozzle:'Nozzle',spool:'Spool'});
    const canvas=recordingCanvas(),result=await renderDesign(design,{makeCanvas:()=>canvas});
    const [w,h]=size.split('x').map(Number);
    assert.equal(result.width,w*8);assert.equal(result.height,h*8);
    assert.ok(design.elements.some(e=>e.qrData==='https://example.com/#spool/unique'));
    assert.equal(design.name,'Real spool');
    assert.ok(design.elements.some(e=>/Nozzle:\s+210°C/.test(e.text||'')));
    assert.doesNotMatch(JSON.stringify(design),/DEMO|0042|Bambu Lab/);
    const resized=resizeDesign(design,'70x80');assert.deepEqual(resized.labelSize,{width:70,height:80});
  }
});

test('design rendering waits for embedded image decoding and preserves text/shape/QR geometry',async()=>{
  const {renderDesign}=await import('../static/label-renderer.js');
  for(const name of ['text-only','advanced']) {
    const design=sampleDesign(name),canvas=recordingCanvas(),images=[];
    const result=await renderDesign(design,{makeCanvas:()=>canvas,loadImage:async data=>{images.push(data);return {decoded:true};}});
    assert.equal(result.width,560);assert.equal(result.height,640);
    assert.deepEqual(canvas.calls.filter(c=>c[0]==='fillText').map(c=>c[1]),design.elements.filter(e=>e.type==='text').map(e=>e.text));
    assert.equal(images.length,name==='advanced'?1:0);
    assert.equal(canvas.calls.filter(c=>c[0]==='drawImage').length,images.length);
    assert.ok(canvas.calls.some(c=>c[0]==='rect'));
    const qr=design.elements.find(e=>e.type==='qr');assert.deepEqual(result.qrRegions,[{x:qr.x,y:qr.y,width:qr.width,height:qr.height}]);
  }
});

test('import validation rejects executable/remote images, unsupported designs, bad geometry and excessive resources',async()=>{
  const {importDesign}=await designModule();
  const changes=[d=>d.elements[0].imageData='https://remote/image.png',d=>d.elements[0].imageData='data:image/svg+xml;base64,PHN2Zz4=',d=>d.elements[0].width=-1,d=>d.elements[0].x=null,d=>d.elements.push({...d.elements[0]}),d=>d.elements[0].type='barcode',d=>d.multiLabel={enabled:true},d=>d.isTemplate=true,d=>d.labelSize.width=100,d=>d.elements.find(e=>e.type==='qr').rotation=45];
  for(const change of changes){const design=sampleDesign('advanced');change(design);assert.throws(()=>importDesign(JSON.stringify(design)),{code:'invalid_design'});}
  assert.throws(()=>importDesign('x'.repeat(1024*1024+1)),{code:'invalid_design'});
  assert.throws(()=>importDesign('{bad'),{code:'invalid_design'});
});

test('raster uses full 576-dot width, MSB first, white transparency and exact pixel alignment',async()=>{
  const {monochromePixels,packRaster,previewPixels}=await rasterModule();
  const pixels=new Uint8ClampedArray([0,0,0,0, 0,0,0,255, 255,255,255,255]);
  const dots=monochromePixels(pixels,3,1);assert.deepEqual([...dots],[0,1,0]);
  const raster=packRaster(dots,3,1);assert.equal(raster.data.length,72);assert.equal(raster.data[71],2);
  for(const width of [320,480,560,559]) {
    const values=new Uint8Array(width*2);values[0]=1;values[width-1]=1;values[width]=1;
    const result=packRaster(values,width,2),offset=576-width;
    assert.ok(result.data[offset>>3] & (1<<(7-(offset&7))));assert.ok(result.data[71]&1);
    assert.ok(result.data[72+(offset>>3)] & (1<<(7-(offset&7))));
    assert.equal(result.widthBytes,72);assert.equal(result.heightLines,2);
  }
  assert.deepEqual([...previewPixels(dots)],[255,255,255,255,0,0,0,255,255,255,255,255]);
  assert.throws(()=>packRaster(new Uint8Array(577),577,1),{code:'invalid_image'});
});

test('dithering is deterministic, leaves inputs untouched, and protects QR/quiet zones',async()=>{
  const {monochromePixels}=await rasterModule();
  const pixels=new Uint8ClampedArray(8*8*4);
  for(let i=0;i<64;i++)pixels.set([i*4,i*4,i*4,255],i*4);
  const original=new Uint8ClampedArray(pixels);
  const threshold=monochromePixels(pixels,8,8);
  for(const mode of ['floyd-steinberg','atkinson','ordered']) {
    const output=monochromePixels(pixels,8,8,mode,[{x:0,y:0,width:8,height:8}]);
    // Fully black and white QR pixels must survive every image conversion mode.
    const binary=new Uint8ClampedArray(pixels.length);
    for(let i=0;i<64;i++){const v=threshold[i]?0:255;binary.set([v,v,v,255],i*4);}
    assert.deepEqual(monochromePixels(binary,8,8,mode,[{x:0,y:0,width:8,height:8}]),threshold);
    assert.deepEqual(monochromePixels(binary,8,8,mode),threshold);
    assert.deepEqual(output,monochromePixels(pixels,8,8,mode,[{x:0,y:0,width:8,height:8}]));
  }
  assert.deepEqual(pixels,original);
});

function mockTransport(kind='bluetooth') {
  return {kind,connected:true,name:'M220',writes:[],disconnects:0,async send(data){this.writes.push([...data]);},async disconnect(){this.connected=false;this.disconnects++;}};
}
function raster(height=2) {return {data:Uint8Array.from({length:72*height},(_,i)=>i%256),widthBytes:72,heightLines:height};}

test('BLE jobs retain upstream commands, density heat map, 128-byte pacing and per-copy feed',async()=>{
  const {PrintJobs}=await jobsModule(),transport=mockTransport(),delays=[],progress=[];
  const jobs=new PrintJobs({delay:async ms=>delays.push(ms)}),image=raster();
  await jobs.run(transport,image,{copies:2,density:3,feed:16},p=>progress.push(p));
  const first=transport.writes.slice(0,7);
  assert.deepEqual(first.slice(0,4),[[27,64],[27,55,7,80,2],[29,124,3],[29,118,48,0,72,0,2,0]]);
  assert.deepEqual(first[4],[...image.data.slice(0,128)]);assert.deepEqual(first[5],[...image.data.slice(128)]);assert.deepEqual(first[6],[27,74,16]);
  assert.deepEqual(transport.writes.slice(7),first);assert.deepEqual(delays.slice(0,7),[100,30,50,20,20,300,800]);
  assert.deepEqual(progress.at(-1),{copy:2,copies:2,percent:100});assert.equal(jobs.busy,false);
});

test('USB jobs retain upstream line spacing, initial feed, 512-byte chunks and adjustable final feed',async()=>{
  const {PrintJobs}=await jobsModule(),transport=mockTransport('usb'),image=raster(8);
  await new PrintJobs({delay:async()=>{}}).run(transport,image,{density:8,feed:0});
  assert.deepEqual(transport.writes.slice(0,5),[[27,64],[29,124,8],[27,51,0],[27,74,12],[29,118,48,0,72,0,8,0]]);
  assert.equal(transport.writes[5].length,512);assert.equal(transport.writes[6].length,64);assert.deepEqual(transport.writes[7],[27,74,0]);
});

test('invalid settings do not write, jobs serialize, and cancellation skips feed without retrying',async()=>{
  const {PrintJobs}=await jobsModule(),transport=mockTransport();
  const jobs=new PrintJobs({delay:async()=>{}});
  for(const settings of [{copies:0},{copies:1.5},{density:9},{feed:256},{feed:-1}])await assert.rejects(jobs.run(transport,raster(),settings),{code:'invalid_settings'});
  assert.equal(transport.writes.length,0);
  let release;const pending=new Promise(resolve=>{release=resolve;});
  transport.send=async bytes=>{transport.writes.push([...bytes]);await pending;};
  const running=jobs.run(transport,raster());
  await assert.rejects(jobs.run(transport,raster()),{code:'busy'});
  jobs.cancel();release();await assert.rejects(running,{code:'cancelled'});
  assert.deepEqual(transport.writes,[[27,64]]);assert.equal(transport.disconnects,1);
});

test('failed and timed-out writes are never replayed and leave the session disconnected',async()=>{
  const {PrintJobs}=await jobsModule();
  for(const timeout of [false,true]) {
    const transport=mockTransport();transport.send=async data=>{transport.writes.push([...data]);if(timeout)await new Promise(()=>{});else throw new Error('GATT failure');};
    await assert.rejects(new PrintJobs({delay:async()=>{},timeoutMs:5}).run(transport,raster()),timeout?{code:'timeout'}:/GATT failure/);
    assert.equal(transport.writes.length,1);assert.equal(transport.connected,false);
  }
});

function bleHardware({withResponse=false,fail=false}={}) {
  const writes=[],requests=[],events=new Map();
  const characteristic={properties:{writeWithoutResponse:!withResponse,write:withResponse},
    async writeValueWithoutResponse(data){writes.push([...data]);if(fail)throw new Error('partial');},async writeValueWithResponse(data){writes.push([...data]);}};
  const device={name:'M220-test',addEventListener:(name,cb)=>events.set(name,cb),removeEventListener:name=>events.delete(name),
    gatt:{connected:false,async connect(){this.connected=true;return {async getPrimaryService(id){assert.equal(id,0xff00);return {async getCharacteristic(id){assert.equal(id,0xff02);return characteristic;}};}};},disconnect(){this.connected=false;}}};
  const environment={isSecureContext:true,navigator:{bluetooth:{async requestDevice(options){requests.push(options);return device;}}}};
  return {environment,device,writes,requests,events};
}

test('Bluetooth only requests permission explicitly, chooses characteristic write mode and never replays writes',async()=>{
  const {BluetoothTransport}=await import('../static/printer-bluetooth.js');
  for(const withResponse of [false,true]) {
    const hw=bleHardware({withResponse});let disconnected=0;
    const transport=new BluetoothTransport({environment:hw.environment,onDisconnect:()=>disconnected++});assert.equal(hw.requests.length,0);
    await transport.connect();await transport.send(new Uint8Array([1,2]));assert.deepEqual(hw.writes,[[1,2]]);
    assert.deepEqual(hw.requests[0].optionalServices,[0xff00]);
    hw.events.get('gattserverdisconnected')();assert.equal(disconnected,1);assert.equal(transport.connected,false);await transport.disconnect();
  }
  const hw=bleHardware({fail:true}),transport=new BluetoothTransport({environment:hw.environment});await transport.connect();await assert.rejects(transport.send(new Uint8Array([1])),/partial/);assert.equal(hw.writes.length,1);await transport.disconnect();
});

test('unsupported/insecure transports never request a device and cancellation opens no fallback chooser',async()=>{
  const {BluetoothTransport}=await import('../static/printer-bluetooth.js');
  const {USBTransport}=await import('../static/printer-usb.js');
  for(const Transport of [BluetoothTransport,USBTransport]) {
    await assert.rejects(new Transport({environment:{isSecureContext:true,navigator:{}}}).connect(),{code:'unsupported'});
    let requests=0;const requestDevice=()=>{requests++;throw Object.assign(new Error(),{name:'NotFoundError'});};
    await assert.rejects(new Transport({environment:{isSecureContext:false,navigator:{usb:{requestDevice},bluetooth:{requestDevice}}}}).connect(),{code:'secure_required'});assert.equal(requests,0);
    await assert.rejects(new Transport({environment:{isSecureContext:true,navigator:{usb:{requestDevice},bluetooth:{requestDevice}}}}).connect(),{name:'NotFoundError'});assert.equal(requests,1);
  }
});

function usbHardware() {
  const calls=[],events=new Map(),alt={alternateSetting:2,interfaceClass:7,endpoints:[{direction:'in',type:'bulk',endpointNumber:1},{direction:'out',type:'bulk',endpointNumber:4}]};
  const device={opened:false,productName:'M220 USB',configuration:{interfaces:[{interfaceNumber:7,alternate:{alternateSetting:0},alternates:[alt]}]},
    async open(){this.opened=true;calls.push('open');},async claimInterface(n){calls.push(['claim',n]);},async selectAlternateInterface(n,a){calls.push(['alternate',n,a]);},
    async transferOut(ep,bytes){calls.push(['out',ep,[...bytes]]);return {status:'ok',bytesWritten:bytes.length};},async close(){calls.push('close');this.opened=false;}};
  const environment={isSecureContext:true,navigator:{usb:{async requestDevice(options){calls.push(['request',options]);return device;},addEventListener:(key,cb)=>events.set(key,cb),removeEventListener:key=>events.delete(key)}}};
  return {device,environment,calls,events};
}

test('USB uses actual interface numbers/alternates, validates OUT transfers, and releases the device',async()=>{
  const {USBTransport}=await import('../static/printer-usb.js'),hw=usbHardware();
  const transport=new USBTransport({environment:hw.environment});await transport.connect();await transport.send(new Uint8Array([8,9]));
  assert.ok(hw.calls.some(c=>JSON.stringify(c)==='["claim",7]'));assert.ok(hw.calls.some(c=>JSON.stringify(c)==='["alternate",7,2]'));assert.ok(hw.calls.some(c=>JSON.stringify(c)==='["out",4,[8,9]]'));
  hw.device.transferOut=async()=>({status:'stall',bytesWritten:0});await assert.rejects(transport.send(new Uint8Array([3])),{code:'send_failed'});
  hw.device.transferOut=async()=>({status:'ok',bytesWritten:0});await assert.rejects(transport.send(new Uint8Array([3])),{code:'send_failed'});
  await transport.disconnect();assert.equal(hw.device.opened,false);assert.equal(hw.events.size,0);
});

test('cancelling pending BLE/USB selection cannot establish a late session',async()=>{
  const {BluetoothTransport}=await import('../static/printer-bluetooth.js'),{USBTransport}=await import('../static/printer-usb.js');
  for(const [Transport,hw,kind] of [[BluetoothTransport,bleHardware(),'bluetooth'],[USBTransport,usbHardware(),'usb']]) {
    let choose;hw.environment.navigator[kind].requestDevice=()=>new Promise(resolve=>{choose=resolve;});
    const transport=new Transport({environment:hw.environment}),pending=transport.connect();await transport.disconnect();choose(hw.device);
    await assert.rejects(pending,{code:'cancelled'});assert.equal(transport.connected,false);assert.equal(hw.device.opened||hw.device.gatt?.connected||false,false);
  }
});

function nativeDOM({fastJobs=false}={}) {
  const all=[],messageListeners=new Set();
  const dispatch=(source,data)=>{for(const listener of messageListeners)listener({source,data,origin:'null'});};
  class Node {
    constructor(tag='div',attrs={},parent=null) {
      this.tag=tag;this.attrs=attrs;this.parent=parent;this.dataset={};this.value='';this.disabled=false;this.textContent='';this.open=false;this.listeners={};
      for(const [key,value] of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
      if(tag==='iframe'){
        this.contentWindow={postMessage:message=>{
          if(['initialize','replace'].includes(message.type))this.frameDesign=JSON.parse(JSON.stringify(message.design));
          if(message.type==='initialize')queueMicrotask(()=>dispatch(this.contentWindow,{channel:'filamentdb-designer',session:message.session,type:'loaded'}));
          if(message.type==='snapshot')queueMicrotask(()=>dispatch(this.contentWindow,{channel:'filamentdb-designer',session:message.session,type:'snapshot',request:message.request,design:this.frameDesign}));
        }};
        Object.defineProperty(this,'src',{set:value=>{if(value)queueMicrotask(()=>dispatch(this.contentWindow,{channel:'filamentdb-designer',type:'ready'}));}});
      }
      if(tag==='canvas'){const c=recordingCanvas();this.getContext=c.getContext;this.toBlob=cb=>cb(new Blob(['png']));}
      all.push(this);
    }
    set innerHTML(html) {
      const descendants=node=>node.parent===this || (node.parent && descendants(node.parent));
      for(let i=all.length-1;i>=0;i--)if(all[i]!==this && descendants(all[i]))all.splice(i,1);
      this.html=html;
      for(const match of html.matchAll(/<(input|select|textarea|canvas|iframe|p|fieldset|div|button)\b([^>]*)>/g)) {
        const attrs={};for(const attribute of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[attribute[1]]=attribute[2]||'';
        const node=new Node(match[1],attrs,this);
        if(match[1]==='select') {
          const after=html.slice(match.index+match[0].length),option=after.match(/<option value="([^"]*)"/);if(option)node.value=option[1];
        }
      }
    }
    get innerHTML(){return this.html||'';}
    matches(selector) {
      if(selector.startsWith('#'))return this.attrs.id===selector.slice(1);
      const match=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return Boolean(match && Object.hasOwn(this.attrs,match[1]) && (match[2]===undefined || this.attrs[match[1]]===match[2]));
    }
    contains(node){return node.parent===this || Boolean(node.parent && this.contains(node.parent));}
    querySelector(selector){return all.find(n=>this.contains(n)&&n.matches(selector))||null;}
    querySelectorAll(selector){return all.filter(n=>this.contains(n)&&selector.split(',').some(s=>n.matches(s)));}
    closest(selector){return this.matches(selector)?this:this.parent?.closest(selector);}
    addEventListener(name,callback){this.listeners[name]=callback;}
    showModal(){this.open=true;}
    close(){this.open=false;this.listeners.close?.();}
    click(){this.clicked=true;}
    remove(){}
    removeAttribute(name){delete this.attrs[name];}
  }
  const root=new Node('dialog',{id:'native-label-dialog'});new Node('div',{id:'native-label-content'},root);
  const storage=new Map(),downloads=[],api=templateAPI();
  const context=vm.createContext({crypto:require('node:crypto').webcrypto,window:{addEventListener:(name,listener)=>{if(name==='message')messageListeners.add(listener);},removeEventListener:(name,listener)=>messageListeners.delete(listener)},fetch:api.fetch,Blob,Intl,Uint8Array,Uint8ClampedArray,Float32Array,isSecureContext:true,navigator:{},
    document:{querySelector:selector=>root.matches(selector)?root:null,createElement:tag=>new Node(tag),fonts:{ready:Promise.resolve()},body:{append(){}}},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:export';},revokeObjectURL(){}},
    Image:class {constructor(){this.naturalWidth=64;this.naturalHeight=64;}set src(value){Promise.resolve().then(()=>this.onload());}},
    setTimeout:(fn,ms)=>setTimeout(fn,ms===30000 || (fastJobs && ms!==15000)?0:ms),clearTimeout,
  });
  const field=name=>root.querySelector('[data-native-field="'+name+'"]'),button=name=>root.querySelector('[data-native-action="'+name+'"]');
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  return {context,root,storage,downloads,field,button,settle,api,
    async click(name){root.onclick({target:button(name)});await settle();},
    async input(name,value){const target=field(name);target.value=value;root.oninput({target});await settle();}};
}

test('native dialog edits the actual design, exports reference JSON, saves per spool and keeps exports available without hardware',async()=>{
  const ui=nativeDOM(),graph=await loadFrontend(ui.context,[],{entry:'label-print-dialog.js',init:false,exposeInternals:false});
  const catalog=JSON.parse(fs.readFileSync('static/locales/en.json','utf8'));graph.get('i18n.js').configureI18n(catalog);
  const spool={id:23,name:'Spool',material:'PLA',manufacturer:'Other',label_token:'token-23'};
  await graph.namespace.openNativeLabelPrinter(spool,'https://example.com/#spool/token-23',{size:'40x30'});
  assert.equal(ui.button('connect').disabled,true);assert.equal(ui.button('print').disabled,true);assert.equal(ui.button('json').disabled,false);assert.equal(ui.button('png').disabled,false);
  const importInput=ui.root.querySelector('[data-native-import]');
  importInput.files=[{size:10000,text:async()=>JSON.stringify(sampleDesign('advanced'))}];
  ui.root.onchange({target:importInput});await ui.settle();
  assert.equal(ui.field('size').value,'70x80');
  await ui.click('json');assert.deepEqual(JSON.parse(await ui.downloads.at(-1).text()),sampleDesign('advanced'));
  const list=ui.root.querySelector('[data-native-elements]');list.value='1';ui.root.onchange({target:list});
  await ui.input('text','Custom edited brand');await ui.input('x','120');await ui.click('save');
  const saved=JSON.parse(ui.storage.get('filamentdb.label-design.token-23.70x80'));
  assert.equal(saved.elements[1].text,'Custom edited brand');assert.equal(saved.elements[1].x,120);
  assert.equal(saved.elements.find(e=>e.type==='qr').qrData,'DEMO-0042','import retains original QR payload');
  await ui.click('reset');await ui.click('json');
  const generated=JSON.parse(await ui.downloads.at(-1).text());assert.equal(generated.elements.find(e=>e.type==='qr').qrData,'https://example.com/#spool/token-23');
  await ui.click('close');assert.equal(ui.root.open,false);
  await graph.namespace.openNativeLabelPrinter(spool,'https://example.com/#spool/token-23');
  await ui.click('json');assert.equal(JSON.parse(await ui.downloads.at(-1).text()).elements[1].text,'Custom edited brand');
});

test('native dialog disables stale preview export/print after invalid edits and rejects malformed imports without replacing design',async()=>{
  const ui=nativeDOM(),graph=await loadFrontend(ui.context,[],{entry:'label-print-dialog.js',init:false,exposeInternals:false});
  graph.get('i18n.js').configureI18n(JSON.parse(fs.readFileSync('static/locales/en.json','utf8')));
  await graph.namespace.openNativeLabelPrinter({id:1,name:'Spool',manufacturer:'Other',material:'PLA',label_token:'one'},'https://example.com/#spool/one',{size:'60x40'});
  await ui.input('width','-1');assert.equal(ui.button('json').disabled,true);assert.equal(ui.button('print').disabled,true);
  assert.match(ui.root.querySelector('[data-native-error]').textContent,/invalid/);
  await ui.input('width','448');assert.equal(ui.button('json').disabled,false);
  const input=ui.root.querySelector('[data-native-import]');input.files=[{size:20,text:async()=>'{invalid'}];ui.root.onchange({target:input});await ui.settle();
  assert.equal(ui.field('name').value,'Spool');assert.match(ui.root.querySelector('[data-native-error]').textContent,/invalid/);
});

test('USB also supports a CDC-data bulk OUT alternate under the M220 USB identity',async()=>{
  const {USBTransport}=await import('../static/printer-usb.js'),hw=usbHardware();
  hw.device.configuration.interfaces[0].alternates[0].interfaceClass=10;
  const transport=new USBTransport({environment:hw.environment});await transport.connect();await transport.send(new Uint8Array([1]));assert.equal(transport.connected,true);await transport.disconnect();
});

test('BLE selects the legacy with-response API before sending when required by the browser',async()=>{
  const {BluetoothTransport}=await import('../static/printer-bluetooth.js'),hw=bleHardware({withResponse:true});
  const service=await (await hw.device.gatt.connect()).getPrimaryService(0xff00),characteristic=await service.getCharacteristic(0xff02);
  characteristic.writeValue=characteristic.writeValueWithResponse;delete characteristic.writeValueWithResponse;
  const transport=new BluetoothTransport({environment:hw.environment});await transport.connect();await transport.send(new Uint8Array([4]));assert.deepEqual(hw.writes,[[4]]);await transport.disconnect();
});

test('an immutable raster snapshot is sent and a mid-raster failure stops subsequent chunks, feed and copies',async()=>{
  const {PrintJobs}=await jobsModule(),transport=mockTransport(),image=raster(3),expected=[...image.data];
  let count=0;transport.send=async bytes=>{transport.writes.push([...bytes]);image.data.fill(0);if(++count===6)throw new Error('partial second chunk');};
  await assert.rejects(new PrintJobs({delay:async()=>{}}).run(transport,image,{copies:2}),/partial second chunk/);
  assert.deepEqual(transport.writes[4],expected.slice(0,128));assert.deepEqual(transport.writes[5],expected.slice(128));assert.equal(transport.writes.length,6);assert.equal(transport.disconnects,1);
});

test('delayed imports cannot overwrite a different spool opened later',async()=>{
  const ui=nativeDOM(),graph=await loadFrontend(ui.context,[],{entry:'label-print-dialog.js',init:false,exposeInternals:false});
  graph.get('i18n.js').configureI18n(JSON.parse(fs.readFileSync('static/locales/en.json','utf8')));
  await graph.namespace.openNativeLabelPrinter({id:1,name:'One',material:'PLA',manufacturer:'Other',label_token:'one'},'https://example.com/#spool/one');
  let finish;const input=ui.root.querySelector('[data-native-import]');input.files=[{size:100,text:()=>new Promise(resolve=>{finish=resolve;})}];ui.root.onchange({target:input});
  await ui.click('close');
  await graph.namespace.openNativeLabelPrinter({id:2,name:'Two',material:'PETG',manufacturer:'Other',label_token:'two'},'https://example.com/#spool/two');
  finish(JSON.stringify(sampleDesign('advanced')));await ui.settle();
  assert.equal(ui.field('name').value,'Two');await ui.click('json');assert.equal(JSON.parse(await ui.downloads.at(-1).text()).elements.find(e=>e.type==='qr').qrData,'https://example.com/#spool/two');
});

test('native dialog connects USB and submits the actual copies, darkness and feed while locking the editor',async()=>{
  const ui=nativeDOM({fastJobs:true}),hw=usbHardware();ui.context.navigator.usb=hw.environment.navigator.usb;
  const graph=await loadFrontend(ui.context,[],{entry:'label-print-dialog.js',init:false,exposeInternals:false});
  graph.get('i18n.js').configureI18n(JSON.parse(fs.readFileSync('static/locales/en.json','utf8')));
  await graph.namespace.openNativeLabelPrinter({id:1,name:'Spool',material:'PLA',manufacturer:'Other',label_token:'one'},'https://example.com/#spool/one',{size:'40x30'});
  assert.equal(ui.field('transport').value,'usb');await ui.click('connect');assert.equal(ui.button('print').disabled,false);
  await ui.input('copies','2');await ui.input('density','3');await ui.input('feed','16');await ui.click('print');
  assert.equal(ui.root.querySelector('[data-native-editor]').disabled,true);assert.equal(ui.button('cancel').disabled,false);
  for(let i=0;i<150 && ui.button('print').disabled;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(ui.button('print').disabled,false);assert.equal(ui.root.querySelector('[data-native-editor]').disabled,false);
  const writes=hw.calls.filter(c=>Array.isArray(c)&&c[0]==='out').map(c=>c[2]);
  assert.equal(writes.filter(data=>JSON.stringify(data)==='[29,124,3]').length,2);
  assert.equal(writes.filter(data=>JSON.stringify(data)==='[27,74,16]').length,2);
  assert.deepEqual(JSON.parse(ui.storage.get('filamentdb.print-settings')),{copies:2,density:3,feed:16});
  assert.match(ui.root.querySelector('[data-native-status]').textContent,/physical printing is not confirmed/);
  await ui.click('close');assert.equal(hw.device.opened,false);
});

test('native labels preserve the shared wordmark, material band, mixed-case type and rounded QR',async()=>{
  const {spoolDesign,importDesign,exportDesign}=await designModule();
  const {BAMBU_LOGO_IMAGE,extendedLabelGeometry}=await import('../static/label-style.js');
  for(const manufacturer of ['Bambu Lab','BambuLab','Bambu',' Bambu Lab '])for(const size of ['40x30','60x40','70x80']) {
    const design=spoolDesign({id:42,name:'PLA Matte',material:'PLA Matte',manufacturer,color:'Blå',color_hex:'#0000ff'},'https://example.com/#spool/permanent',{size,nozzle:'190–230°C',bed:'55–65°C',drying:'50°C/8h'},{nozzle:'Dyse',bed:'Plade',drying:'Tørring',flow:'Flow ratio'});
    const g=extendedLabelGeometry(design.labelSize.width*8,design.labelSize.height*8);
    const brand=design.elements.find(e=>e.id==='brand');assert.equal(brand.imageData,BAMBU_LOGO_IMAGE);assert.equal(brand.width,g.contentWidth);assert.equal(brand.height,g.headerHeight);
    assert.match(decodeURIComponent(brand.imageData),/CC BY-SA 4.0/);
    const material=design.elements.find(e=>e.id==='material');assert.equal(material.text,'PLA Matte');assert.equal(material.color,'white');assert.equal(material.background,'black');assert.equal(material.width,g.barWidth);
    const hex=design.elements.find(e=>e.id==='color-hex');assert.equal(hex.text,'#0000FF');assert.ok(hex.x>=material.x+material.width);
    const qr=design.elements.find(e=>e.type==='qr');assert.equal(qr.finderStyle,'round-top-left');assert.equal(qr.x,g.qrX);assert.equal(qr.y,g.qrY);
    assert.equal(design.elements.find(e=>e.id==='flow').text,'Flow ratio: —');
    assert.deepEqual(importDesign(exportDesign(design)),design);
    for(const element of design.elements){assert.ok(element.x+element.width<=design.labelSize.width*8);assert.ok(element.y+element.height<=design.labelSize.height*8);}
  }
});

test('shared QR artwork changes only the top-left finder and keeps data modules intact',async()=>{
  const {qrArtwork}=await import('../static/label-style.js'),{default:qrcodegen}=await import('../static/vendor/qrcodegen.js');
  const qr=qrcodegen.QrCode.encodeText('https://example.com/#spool/unique',qrcodegen.QrCode.Ecc.MEDIUM);
  const styled=qrArtwork(qr,true),actual=new Set(styled.modules.map(({x,y})=>x+','+y));
  for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)assert.equal(actual.has(x+','+y),x<7&&y<7?false:qr.getModule(x,y));
  assert.deepEqual(styled.circles,[{radius:3.5,fill:'black'},{radius:2.5,fill:'white'},{radius:1.5,fill:'black'}]);
  assert.equal(qrArtwork(qr,false).circles.length,0);
  const {spoolDesign}=await designModule(),{renderDesign}=await import('../static/label-renderer.js');
  const design=spoolDesign({id:1,name:'PLA',material:'PLA',manufacturer:'Other'},'https://example.com/#spool/unique');
  const canvas=recordingCanvas();await renderDesign(design,{makeCanvas:()=>canvas});
  assert.equal(canvas.calls.filter(call=>call[0]==='ellipse').length,3);
});

test('native preset changes reflow the shared wordmark layout and only the exact bundled SVG is accepted',async()=>{
  const ui=nativeDOM(),graph=await loadFrontend(ui.context,[],{entry:'label-print-dialog.js',init:false,exposeInternals:false});
  graph.get('i18n.js').configureI18n(JSON.parse(fs.readFileSync('static/locales/en.json','utf8')));
  await graph.namespace.openNativeLabelPrinter({id:1,name:'PLA Matte',material:'PLA Matte',manufacturer:'Bambu Lab',label_token:'one'},'https://example.com/#spool/one');
  const input=ui.field('size');input.value='60x40';ui.root.onchange({target:input});await ui.settle();await ui.click('json');
  const design=JSON.parse(await ui.downloads.at(-1).text()),brand=design.elements.find(e=>e.id==='brand');
  assert.equal(brand.width,448);assert.equal(brand.height,53);assert.match(decodeURIComponent(brand.imageData),/width="560" height="66"/);
  const {importDesign}=await designModule();brand.imageData+='modified';assert.throws(()=>importDesign(JSON.stringify(design)),{code:'invalid_design'});
});

test('native editor selects each sizes template, preserves size drafts, and replaces stale saved overrides when the template changes',async()=>{
  const ui=nativeDOM(),graph=await loadFrontend(ui.context,[],{entry:'label-print-dialog.js',init:false,exposeInternals:false});
  graph.get('i18n.js').configureI18n(JSON.parse(fs.readFileSync('static/locales/en.json','utf8')));
  const templates=graph.get('label-templates.js'),store=graph.get('label-template-store.js');await store.loadSharedLabelTemplates();
  for(const size of ['40x30','60x40','70x80']){
    const template=templates.exampleLabelTemplate(size);template.name='Template '+size;template.elements[0].text=size+' $filamentname$ $filamentcolor$';await store.saveSharedLabelTemplate(size,JSON.stringify(template));
  }
  const spool={id:42,name:'Blue spool',material:'PLA',manufacturer:'Other',color_hex:'#0000ff',label_token:'blue-42'};
  await graph.namespace.openNativeLabelPrinter(spool,'https://example.com/#spool/blue-42');assert.equal(ui.field('size').value,'70x80');
  await ui.click('json');let design=JSON.parse(await ui.downloads.at(-1).text());assert.equal(design.elements[0].text,'70x80 Blue spool #0000FF');
  const change=async size=>{const target=ui.field('size');target.value=size;ui.root.onchange({target});await ui.settle();};
  await change('40x30');await ui.input('text','Custom 40x30');await ui.click('save');
  const saved=ui.storage.get('filamentdb.label-design.blue-42.40x30');assert.equal(JSON.parse(saved).elements[0].text,'Custom 40x30');
  await change('60x40');await ui.click('json');design=JSON.parse(await ui.downloads.at(-1).text());assert.equal(design.elements[0].text,'60x40 Blue spool #0000FF');
  await change('40x30');assert.equal(ui.field('text').value,'Custom 40x30');
  const replacement=templates.exampleLabelTemplate('40x30');replacement.name='Replacement';replacement.elements[0].text='New $filamentname$';await store.saveSharedLabelTemplate('40x30',JSON.stringify(replacement));
  await ui.click('close');await graph.namespace.openNativeLabelPrinter(spool,'https://example.com/#spool/blue-42',{size:'40x30'});
  assert.equal(ui.field('text').value,'New Blue spool');assert.equal(ui.storage.get('filamentdb.label-design.blue-42.40x30'),saved);
  await ui.click('close');await graph.namespace.openNativeLabelPrinter({...spool,id:43,name:'Red spool',color_hex:'#ff0000',label_token:'red-43'},'https://example.com/#spool/red-43',{size:'60x40'});
  await ui.click('json');design=JSON.parse(await ui.downloads.at(-1).text());assert.equal(design.elements[0].text,'60x40 Red spool #FF0000');assert.equal(design.elements.find(e=>e.type==='qr').qrData,'https://example.com/#spool/red-43');
});

test('invalid shared template responses block preview/print across size changes',async()=>{
  const ui=nativeDOM(),graph=await loadFrontend(ui.context,[],{entry:'label-print-dialog.js',init:false,exposeInternals:false});
  graph.get('i18n.js').configureI18n(JSON.parse(fs.readFileSync('static/locales/en.json','utf8')));
  ui.api.records.set('70x80',{size:'70x80',revision:'corrupt',design:{}});
  await graph.namespace.openNativeLabelPrinter({id:1,name:'Spool',manufacturer:'Other',material:'PLA',label_token:'one'},'https://example.com/#spool/one',{size:'70x80'});
  assert.match(ui.root.querySelector('[data-native-error]').textContent,/template|database/i);assert.equal(ui.button('json').disabled,true);assert.equal(ui.button('print').disabled,true);
  const target=ui.field('size');target.value='40x30';ui.root.onchange({target});await ui.settle();assert.equal(ui.button('json').disabled,true);
});

test('a new template takes precedence over legacy saved designs without deleting them',async()=>{
  const ui=nativeDOM(),graph=await loadFrontend(ui.context,[],{entry:'label-print-dialog.js',init:false,exposeInternals:false});
  graph.get('i18n.js').configureI18n(JSON.parse(fs.readFileSync('static/locales/en.json','utf8')));
  const legacy=sampleDesign('advanced');legacy.name='Legacy design';ui.storage.set('filamentdb.label-design.one',JSON.stringify(legacy));
  const templates=graph.get('label-templates.js'),store=graph.get('label-template-store.js');await store.loadSharedLabelTemplates();const template=templates.exampleLabelTemplate('70x80');template.name='Configured';await store.saveSharedLabelTemplate('70x80',JSON.stringify(template));
  const spool={id:1,name:'Current spool',manufacturer:'Other',material:'PLA',label_token:'one'};
  await graph.namespace.openNativeLabelPrinter(spool,'https://example.com/#spool/one');assert.notEqual(ui.field('name').value,'Legacy design');assert.equal(JSON.parse(ui.storage.get('filamentdb.label-design.one')).name,'Legacy design');
  await ui.click('close');await store.removeSharedLabelTemplate('70x80');await graph.namespace.openNativeLabelPrinter(spool,'https://example.com/#spool/one');assert.equal(ui.field('name').value,'Legacy design');
});

test('native QR fills its square with a one-module margin and pixel-snapped boundaries at every size and rotation',async()=>{
  const {renderDesign}=await import('../static/label-renderer.js');
  const {default:qrcodegen}=await import('../static/vendor/qrcodegen.js');
  const payload='https://filament.example/#spool/permanent-identity-0042';
  const qr=qrcodegen.QrCode.encodeText(payload,qrcodegen.QrCode.Ecc.MEDIUM),cells=qr.size+2;
  for(const side of [157,200,237,280])for(const rotation of [0,90,180,270]){
    const element={id:'qr',type:'qr',x:20,y:100,width:side+16,height:side,rotation,qrData:payload,errorCorrection:'M'};
    const canvas=recordingCanvas();await renderDesign({version:3,name:'QR fit',labelSize:{width:70,height:80},elements:[element]},{makeCanvas:()=>canvas});
    const black=canvas.calls.filter(c=>c[0]==='fillRect').slice(2),expected=[];
    const left=-(side+16)/2+8,top=-side/2,edge=n=>Math.floor(n*side/cells);
    for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))expected.push(['fillRect',left+edge(x+1),top+edge(y+1),edge(x+2)-edge(x+1),edge(y+2)-edge(y+1)]);
    assert.deepEqual(black,expected);
    assert.equal(Math.min(...black.map(c=>c[1])),left+edge(1));
    assert.equal(Math.max(...black.map(c=>c[1]+c[3])),left+edge(qr.size+1));
    assert.ok(black.every(c=>Number.isInteger(c[3])&&Number.isInteger(c[4])&&c[3]>=2&&c[4]>=2));
  }
});
