const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadFrontend}=require('./frontend-loader.cjs');
const driver=()=>import('../static/m220-bluetooth.js');
function hardware({withResponse=false,name='M220-test',failAt=0,disconnectAt=0}={}) {
  const writes=[],events=new Map(),services=[],characteristics=[],requests=[];
  let connected=false,disconnects=0;
  const characteristic={properties:{write:withResponse,writeWithoutResponse:!withResponse}};
  const write=async bytes=>{
    writes.push([...bytes]);
    if(disconnectAt===writes.length){connected=false;events.get('gattserverdisconnected')?.();}
    if(failAt===writes.length)throw new Error('Radio lost');
  };
  characteristic[withResponse?'writeValueWithResponse':'writeValueWithoutResponse']=write;
  const device={name,addEventListener:(key,callback)=>events.set(key,callback),removeEventListener:key=>events.delete(key),gatt:{
    get connected(){return connected;},
    async connect(){connected=true;return {async getPrimaryService(id){services.push(id);return {async getCharacteristic(id){characteristics.push(id);return characteristic;}};}};},
    disconnect(){disconnects++;connected=false;},
  }};
  const bluetooth={requestDevice:async options=>{requests.push(options);return device;}};
  return {bluetooth,device,writes,services,characteristics,requests,characteristic,events,get disconnects(){return disconnects;}};
}
async function setup(options={}) {
  const {M220Printer}=await driver(),hw=hardware(options),delays=[];
  const raster={data:new Uint8Array(144).fill(0xa5),widthBytes:72,heightLines:2};
  const printer=new M220Printer({bluetooth:hw.bluetooth,secure:true,delay:async ms=>{delays.push(ms);},rasterize:async()=>raster});
  return {printer,hw,delays,raster};
}

test('M220 raster packs MSB first, right aligns without scaling and composites transparency on white',async()=>{
  const {packM220Raster}=await driver();
  // A 9-dot label spans two output bytes at the right edge of the 576-dot head.
  const pixels=new Uint8ClampedArray(9*2*4).fill(255);
  const pixel=(x,y,red,alpha=255)=>pixels.set([red,red,red,alpha],(y*9+x)*4);
  pixel(0,0,0);pixel(1,0,0);pixel(8,0,0);
  pixel(0,1,0,0);pixel(1,1,159);pixel(8,1,160);
  const result=packM220Raster({data:pixels,width:9,height:2});
  assert.equal(result.widthBytes,72);assert.equal(result.heightLines,2);
  assert.deepEqual([...result.data.slice(0,70)],new Array(70).fill(0));
  assert.deepEqual([...result.data.slice(70,72)],[1,129]);
  assert.deepEqual([...result.data.slice(142)],[0,128]);
  for(const width of [320,480,559]) {
    const rgba=new Uint8ClampedArray(width*4).fill(255);
    rgba.set([0,0,0,255],0);rgba.set([0,0,0,255],(width-1)*4);
    const packed=packM220Raster({data:rgba,width,height:1}).data;
    const black=[];
    for(let x=0;x<576;x++)if(packed[x>>3]&(128>>(x%8)))black.push(x);
    assert.deepEqual(black,[576-width,575]);
  }
  assert.throws(()=>packM220Raster({data:[],width:577,height:1}),{code:'invalid_image'});
  assert.throws(()=>packM220Raster({data:[],width:8,height:1}),{code:'invalid_image'});
});

test('M220 connects only on explicit request and sends documented control frames and chunked raster',async()=>{
  const {printer,hw,delays,raster}=await setup();
  assert.equal(hw.requests.length,0);
  await printer.connect();
  assert.equal(hw.requests.length,1);
  assert.deepEqual(hw.requests[0].optionalServices,[0xff00]);
  assert.deepEqual(hw.services,[0xff00]);assert.deepEqual(hw.characteristics,[0xff02]);
  assert.equal(hw.writes.length,0,'connecting must never feed or print');
  const progress=[];
  await printer.print({svg:'edited preview'},{onProgress:value=>progress.push(value)});
  assert.deepEqual(hw.writes.slice(0,4),[
    [0x1b,0x40],[0x1b,0x37,7,140,2],[0x1d,0x7c,6],[0x1d,0x76,0x30,0,72,0,2,0],
  ]);
  assert.deepEqual(hw.writes.slice(4,-1).flat(),[...raster.data]);
  assert.deepEqual(hw.writes.slice(4,-1).map(bytes=>bytes.length),[128,16]);
  assert.deepEqual(hw.writes.at(-1),[0x1b,0x4a,32]);
  assert.deepEqual(progress,[89,100]);
  assert.ok(delays.includes(20));
  assert.equal(printer.busy,false);assert.equal(printer.connected,true);
});

test('M220 supports response-only GATT, conservative packets, and a 16-bit row count',async()=>{
  const {printer,hw}=await setup({withResponse:true});
  printer.rasterize=async()=>({data:new Uint8Array(72*320),widthBytes:72,heightLines:320});
  await printer.connect();
  await printer.print({}, {chunkSize:20,density:1,feed:0});
  assert.deepEqual(hw.writes[1],[0x1b,0x37,7,40,2]);
  assert.deepEqual(hw.writes[3],[0x1d,0x76,0x30,0,72,0,64,1]);
  assert.ok(hw.writes.slice(4,-1).every(bytes=>bytes.length<=20));
  assert.equal(hw.writes.slice(4,-1).flat().length,72*320);
  assert.deepEqual(hw.writes.at(-1),[0x1b,0x4a,0]);
});

test('M220 requires a secure supported browser, rejects other models and treats picker cancellation as final',async()=>{
  const {M220Printer}=await driver();
  const hw=hardware();
  await assert.rejects(new M220Printer({bluetooth:hw.bluetooth,secure:false}).connect(),{code:'secure_required'});
  await assert.rejects(new M220Printer({bluetooth:null,secure:true}).connect(),{code:'unsupported'});
  assert.equal(hw.requests.length,0);
  let picks=0;
  const cancelled=new M220Printer({secure:true,bluetooth:{requestDevice:async()=>{picks++;throw Object.assign(new Error(),{name:'NotFoundError'});}}});
  await assert.rejects(cancelled.connect(),{code:'cancelled'});
  assert.equal(picks,1);assert.equal(cancelled.busy,false);
  const {printer,hw:wrong}=await setup({name:'M110'});
  await assert.rejects(printer.connect(),{code:'wrong_device'});
  assert.equal(wrong.writes.length,0);
});

test('M220 serializes all jobs and disconnect cancels raster work before any printer bytes',async()=>{
  const {printer,hw}=await setup();
  await printer.connect();
  let finishRaster;
  printer.rasterize=()=>new Promise(resolve=>{finishRaster=resolve;});
  const first=printer.print({});
  assert.equal(printer.busy,true);
  await assert.rejects(printer.print({}),{code:'busy'});
  await assert.rejects(printer.connect(),{code:'busy'});
  printer.disconnect();
  finishRaster({data:new Uint8Array(72),widthBytes:72,heightLines:1});
  await assert.rejects(first,{code:'disconnected'});
  assert.equal(hw.writes.length,0);assert.equal(printer.busy,false);
});

test('M220 never resends a failed or disconnected raster chunk and skips the feed command',async()=>{
  for(const options of [{failAt:5},{disconnectAt:5}]) {
    const {printer,hw}=await setup(options);
    await printer.connect();
    await assert.rejects(printer.print({}),error=>['send_failed','disconnected'].includes(error.code));
    assert.equal(hw.writes.length,5);
    assert.equal(printer.connected,false);assert.equal(printer.busy,false);
    assert.equal(hw.requests.length,1);
    assert.ok(!hw.writes.some(bytes=>bytes[0]===0x1b && bytes[1]===0x4a));
  }
});

test('disabling while the picker is pending cannot establish a late Bluetooth connection',async()=>{
  const {printer,hw}=await setup();
  let choose;
  printer.bluetooth={requestDevice:()=>new Promise(resolve=>{choose=resolve;})};
  const pending=printer.connect();
  printer.disconnect();choose(hw.device);
  await assert.rejects(pending,{code:'disconnected'});
  assert.equal(hw.device.gatt.connected,false);assert.equal(printer.connected,false);
});

test('M220 rasterization uses the exact label dimensions and releases the SVG URL on decoding errors',async()=>{
  const {rasterizeM220Label}=await driver();
  const originals={document:global.document,Image:global.Image,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  const draws=[],revoked=[];
  const canvas={getContext:()=>({fillRect(){},drawImage:(...args)=>draws.push(args),getImageData:()=>({width:320,height:240,data:new Uint8ClampedArray(320*240*4).fill(255)})})};
  global.document={createElement:()=>canvas};
  global.Image=class {set src(value){this.onload();}};
  URL.createObjectURL=()=> 'blob:m220';URL.revokeObjectURL=url=>revoked.push(url);
  try {
    const raster=await rasterizeM220Label({svg:'<svg/>',width:320,height:240});
    assert.equal(canvas.width,320);assert.equal(canvas.height,240);
    assert.deepEqual(draws[0].slice(1),[0,0,320,240]);
    assert.equal(raster.data.length,72*240);assert.ok(raster.data.every(value=>value===0));
    global.Image=class {set src(value){this.onerror();}};
    await assert.rejects(rasterizeM220Label({svg:'<svg/>',width:320,height:240}),{code:'invalid_image'});
    assert.deepEqual(revoked,['blob:m220','blob:m220']);
  } finally {
    global.document=originals.document;global.Image=originals.Image;
    URL.createObjectURL=originals.create;URL.revokeObjectURL=originals.revoke;
  }
});

async function uiFixture({secure=true,initialStorage={}}={}) {
  const nodes=new Map(),listeners=new Map(),storage=new Map(Object.entries(initialStorage)),hw=hardware(),rasterized=[];
  const button={dataset:{m220Print:'12'},hidden:true,disabled:true,closest:()=>null};
  const originalPrint=()=>{},originalDownload=()=>{};
  const document={querySelector(selector){
    if(!nodes.has(selector))nodes.set(selector,{value:'',checked:false,hidden:false,textContent:''});
    return nodes.get(selector);
  },querySelectorAll(selector){return selector==='[data-m220-print]'?[button]:[];},addEventListener:(key,callback)=>listeners.set(key,callback)};
  for(const [id,value] of [['density','6'],['feed','32'],['chunk','128']])document.querySelector('#m220-'+id).value=value;
  document.querySelector('#label-print').onclick=originalPrint;document.querySelector('#thermal-download').onclick=originalDownload;
  const context=vm.createContext({URL,Intl,Uint8Array,setTimeout,clearTimeout,isSecureContext:secure,navigator:{bluetooth:hw.bluetooth},document,
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},window:{addEventListener(){}}});
  const graph=await loadFrontend(context,[],{entry:'m220-printing.js',init:false});
  context.rasterizeM220Label=async label=>{rasterized.push(label);return {data:new Uint8Array(72),widthBytes:72,heightLines:1};};
  const editedLabel={svg:'<svg>edited 275°C</svg>',width:480,height:320};
  graph.namespace.initM220Printing({getDialogLabel:()=>editedLabel,getGalleryLabel:id=>id===12?editedLabel:null});
  return {nodes,listeners,storage,hw,button,editedLabel,rasterized,originalPrint,originalDownload};
}

test('optional UI is off by default; Bluetooth sends the edited card independently of existing print/download',async()=>{
  const ui=await uiFixture();
  assert.equal(ui.hw.requests.length,0);assert.equal(ui.button.hidden,true);
  assert.equal(ui.nodes.get('#m220-connect').disabled,true);
  const checkbox=ui.nodes.get('#m220-enabled');checkbox.checked=true;checkbox.onchange();
  assert.equal(ui.button.hidden,false);assert.equal(ui.button.disabled,true);
  assert.equal(ui.nodes.get('#m220-availability').textContent,'Printer tilgængelig');
  await ui.nodes.get('#m220-connect').onclick();
  assert.equal(ui.button.disabled,false);assert.equal(ui.hw.writes.length,0);
  await ui.listeners.get('click')({target:{closest:()=>ui.button}});
  assert.deepEqual(ui.rasterized,[ui.editedLabel]);
  assert.match(ui.nodes.get('#m220-status').textContent,/ikke bekræftet/);
  assert.equal(ui.nodes.get('#label-print').onclick,ui.originalPrint);
  assert.equal(ui.nodes.get('#thermal-download').onclick,ui.originalDownload);
  checkbox.checked=false;checkbox.onchange();
  assert.equal(ui.button.hidden,true);assert.equal(ui.hw.device.gatt.connected,false);
  assert.equal(ui.nodes.get('#m220-availability').textContent,'Printer ikke tilgængelig');
  assert.equal(ui.storage.get('filamentdb.m220.enabled'),'false');
  await ui.listeners.get('click')({target:{closest:()=>ui.button}});
  assert.equal(ui.rasterized.length,1);
});

test('optional UI explains insecure origins and never opens a Bluetooth picker there',async()=>{
  const ui=await uiFixture({secure:false});
  const checkbox=ui.nodes.get('#m220-enabled');checkbox.checked=true;checkbox.onchange();
  assert.equal(ui.nodes.get('#m220-connect').disabled,true);
  assert.match(ui.nodes.get('#m220-status').textContent,/HTTPS/);
  assert.equal(ui.hw.requests.length,0);
  assert.equal(ui.nodes.get('#label-print').onclick,ui.originalPrint);
});

test('newer M220 units can be selected by their generic Q advertisement name',async()=>{
  const {printer,hw}=await setup({name:'Q199E-M220-unit'});
  await printer.connect();
  assert.equal(printer.connected,true);
  assert.ok(hw.requests[0].filters.some(filter=>filter.namePrefix==='Q'));
  assert.equal(hw.writes.length,0);
  printer.disconnect();
});


test('Administration restores browser-local availability and valid printer settings without pairing automatically',async()=>{
  const ui=await uiFixture({initialStorage:{
    'filamentdb.m220.enabled':'true',
    'filamentdb.m220.settings':JSON.stringify({density:3,feed:16,chunk:20}),
  }});
  assert.equal(ui.nodes.get('#m220-enabled').checked,true);
  assert.equal(ui.nodes.get('#m220-availability').textContent,'Printer tilgængelig');
  assert.equal(ui.hw.requests.length,0);
  assert.equal(ui.button.disabled,true,'availability does not establish a Bluetooth connection');
  assert.equal(ui.nodes.get('#m220-density').value,'3');
  assert.equal(ui.nodes.get('#m220-feed').value,'16');
  assert.equal(ui.nodes.get('#m220-chunk').value,'20');
  ui.nodes.get('#m220-density').value='4';
  ui.nodes.get('#m220-density').onchange();
  assert.deepEqual(JSON.parse(ui.storage.get('filamentdb.m220.settings')),{density:4,feed:16,chunk:20});
  ui.nodes.get('#m220-feed').value='999';
  ui.nodes.get('#m220-feed').onchange();
  assert.equal(JSON.parse(ui.storage.get('filamentdb.m220.settings')).feed,16);
});
