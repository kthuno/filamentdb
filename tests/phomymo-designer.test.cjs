const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {loadFrontend}=require('./frontend-loader.cjs');
const {templateAPI}=require('./template-api.cjs');
function example(){return JSON.parse(fs.readFileSync('docs/examples/label-template-70x80.json','utf8'));}
async function bridgeFixture(){
  const listeners=new Set(),sent=[],errors=[],changes=[],pending=new Map();let serial=0;
  const frame={contentWindow:{postMessage:message=>sent.push(message)},removeAttribute(){this.removed=true;}};
  const context=vm.createContext({crypto:require('node:crypto').webcrypto,window:{addEventListener:(name,fn)=>listeners.add(fn),removeEventListener:(name,fn)=>listeners.delete(fn)},setTimeout:fn=>{pending.set(++serial,fn);return serial;},clearTimeout:id=>pending.delete(id)});
  const graph=await loadFrontend(context,[],{entry:'phomymo-designer.js',init:false,exposeInternals:false});
  const model=await import('../static/label-templates.js'),design=example();
  const editor=new graph.namespace.PhomymoDesigner(frame,{design,validate:json=>model.importLabelTemplate(json,'70x80'),onChange:d=>changes.push(d),onError:e=>errors.push(e)});
  const receive=(message,source=frame.contentWindow,origin='null')=>{for(const fn of listeners)fn({source,origin,data:{channel:'filamentdb-designer',session:editor.session,...message}});};
  receive({type:'ready'});receive({type:'loaded'});
  return {editor,frame,receive,sent,changes,errors,pending};
}

test('designer bridge accepts only its own opaque frame and session, validates size/content, and discards late messages',async()=>{
  const f=await bridgeFixture(),edited=example();edited.elements[0].text='Changed $manufacturer$';
  f.receive({type:'changed',design:edited},{},'null');f.receive({type:'changed',design:edited},f.frame.contentWindow,'https://evil.example');f.receive({type:'changed',session:'wrong',design:edited});assert.equal(f.changes.length,0);
  f.receive({type:'changed',design:edited});assert.equal(f.changes.length,1);
  const invalid=example();invalid.elements[0].text='$unknown$';f.receive({type:'changed',design:invalid});assert.equal(f.errors.length,1);assert.equal(f.changes.length,1);
  const wrongSize=example();wrongSize.labelSize.width=60;f.receive({type:'changed',design:wrongSize});assert.equal(f.errors.length,2);
  f.editor.dispose();f.receive({type:'changed',design:edited});assert.equal(f.changes.length,1);assert.equal(f.pending.size,0);assert.equal(f.frame.removed,true);
});

test('save/print snapshots wait for the latest canvas state and disposal rejects pending requests',async()=>{
  const f=await bridgeFixture(),edited=example();edited.elements[0].x=45;
  const promise=f.editor.snapshot(),request=f.sent.at(-1);assert.equal(request.type,'snapshot');
  f.receive({type:'snapshot',request:request.request,design:edited});assert.equal((await promise).elements[0].x,45);
  const stale=f.editor.snapshot();f.editor.dispose();await assert.rejects(stale,{code:'cancelled'});assert.equal(f.pending.size,0);
});

test('an open template editor retains its revision even if a background load sees a newer template',async()=>{
  const api=templateAPI(),context=vm.createContext({fetch:api.fetch});
  const graph=await loadFrontend(context,[],{entry:'label-template-store.js',init:false,exposeInternals:false});
  await graph.namespace.loadSharedLabelTemplates();await graph.namespace.saveSharedLabelTemplate('70x80',JSON.stringify(example()));
  const revision=api.records.get('70x80').revision;
  await graph.namespace.saveSharedLabelTemplate('70x80',JSON.stringify(example()));
  await assert.rejects(graph.namespace.saveSharedLabelTemplate('70x80',JSON.stringify(example()),{expectedRevision:revision}),{code:'template_conflict'});
  assert.notEqual(api.records.get('70x80').revision,revision);
});

test('bundled designer imports and dependencies are local, sandboxed, and printing is delegated to the host',()=>{
  const html=fs.readFileSync('static/vendor/phomymo/index.html','utf8');
  assert.doesNotMatch(html,/<(?:script|link|img)[^>]*(?:src|href)=["']https?:/i);
  assert.match(fs.readFileSync('static/phomymo-designer.js','utf8'),/sandbox="allow-scripts allow-downloads"/);
  for(const file of ['usb.js','ble.js'])assert.doesNotMatch(fs.readFileSync('static/vendor/phomymo/'+file,'utf8'),/requestDevice|transferOut|writeValue/);
  const bridge=fs.readFileSync('static/vendor/phomymo/bridge.js','utf8');assert.doesNotMatch(bridge,/\/api\/|fetch\(/);
});

test('designer barcodes validate and produce native print output',async()=>{
  const {validateDesign}=await import('../static/label-design.js'),{renderDesign}=await import('../static/label-renderer.js');
  const design={name:'Barcode',version:3,labelSize:{width:70,height:80},elements:[{id:'code',type:'barcode',x:20,y:30,width:480,height:100,rotation:0,barcodeData:'12345678',barcodeFormat:'CODE128'}]};
  assert.equal(validateDesign(design),design);const fills=[],texts=[];
  const ctx={save(){},restore(){},translate(){},rotate(){},fillRect:(...args)=>fills.push(args),fillText:text=>texts.push(text),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})};
  await renderDesign(design,{makeCanvas:()=>({getContext:()=>ctx})});assert.ok(fills.length>20);assert.deepEqual(texts,['12345678']);
  design.elements[0].width=10;await assert.rejects(renderDesign(design,{makeCanvas:()=>({getContext:()=>ctx})}),{code:'barcode_too_dense'});
  design.elements[0].barcodeFormat='remote';assert.throws(()=>validateDesign(design),{code:'invalid_design'});
});


test('designer image filters and per-image dithering reach the native canvas',async()=>{
  const {renderDesign}=await import('../static/label-renderer.js');
  const image={id:'image',type:'image',x:10,y:10,width:32,height:24,imageData:'data:image/png;base64,AA==',brightness:25,contrast:-10,dither:'threshold'};
  const canvases=[];
  const makeCanvas=()=>{const filters=[],calls=[],ctx={filters,calls,save(){},restore(){},translate(){},rotate(){},fillRect(){},drawImage:(...args)=>calls.push(['image',...args]),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(255)}),putImageData:data=>calls.push(['pixels',data])};Object.defineProperty(ctx,'filter',{set:value=>filters.push(value)});const canvas={getContext:()=>ctx};canvases.push(canvas);return canvas;};
  await renderDesign({version:3,name:'Image',labelSize:{width:40,height:30},elements:[image]},{makeCanvas,loadImage:async()=>({decoded:true})});
  assert.equal(canvases.length,2);const target=canvases[1].getContext();assert.deepEqual(target.filters,['brightness(1.25) contrast(0.9)','none']);assert.ok(target.calls.some(c=>c[0]==='pixels'));
});
