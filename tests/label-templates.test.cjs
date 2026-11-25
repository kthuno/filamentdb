const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {loadFrontend}=require('./frontend-loader.cjs');
const {templateAPI}=require('./template-api.cjs');
function memoryStorage() {
  const values=new Map();return {values,getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
const spool={id:42,name:'Blue spool',manufacturer:'Bambu Lab',material:'PLA Matte',color:'Blå',color_hex:'#0000ff',product_id:'123',product_url:'https://example.com/product',diameter:1.75,weight:1000,remaining:430,location:'Box 1',active_slot:'AMS 2',notes:'Some notes',nozzle_temp:210,bed_temp:60};
const link='https://filament.example/#spool/permanent-42';

test('all three size-specific examples bind variables without changing the template or mixing spool identities',async()=>{
  const m=await import('../static/label-templates.js');
  for(const size of ['40x30','60x40','70x80']) {
    const template=m.exampleLabelTemplate(size),source=JSON.stringify(template);
    const imported=m.importLabelTemplate(source,size),first=m.instantiateLabelTemplate(imported,spool,link),second=m.instantiateLabelTemplate(imported,{...spool,id:43,name:'Other',color_hex:'#ff0000'},'https://filament.example/#spool/permanent-43');
    assert.equal(JSON.stringify(template),source);assert.equal(first.elements.find(e=>e.type==='qr').qrData,link);assert.match(first.elements.find(e=>e.id==='color').text,/#0000FF/);
    assert.equal(second.elements.find(e=>e.type==='qr').qrData,'https://filament.example/#spool/permanent-43');assert.match(second.elements.find(e=>e.id==='color').text,/#FF0000/);
    const [w,h]=size.split('x').map(Number);assert.deepEqual(first.labelSize,{width:w,height:h});
    for(const element of first.elements){assert.ok(element.x+element.width<=w*8);assert.ok(element.y+element.height<=h*8);}
  }
});

test('documented variables include RGB hex, rgb(), numeric units and profile overrides with explicit unknowns',async()=>{
  const {labelTemplateVariables,TEMPLATE_VARIABLES}=await import('../static/label-templates.js');
  const values=labelTemplateVariables(spool,link,{nozzle:'190–230°C',bed:'55–65°C',flow:'0.96',drying:'50°C/8h'},'40x30');
  assert.deepEqual(Object.keys(values).sort(),[...TEMPLATE_VARIABLES].sort());
  assert.equal(values.filamentcolor,'#0000FF');assert.equal(values.filamentcolorrgb,'rgb(0, 0, 255)');assert.equal(values.filamentcolorname,'Blå');assert.equal(values.spoolnumber,'0042');
  assert.equal(values.diameter,'1.75');assert.equal(values.remainingweight,'430');assert.equal(values.nozzletemperature,'190–230°C');assert.equal(values.flowratio,'0.96');assert.equal(values.labelheight,'30');
  const unknown=labelTemplateVariables({id:0,color_hex:'invalid',remaining:0},link);
  assert.equal(unknown.filamentcolor,'#000000');assert.equal(unknown.filamentcolorrgb,'rgb(0, 0, 0)');assert.equal(unknown.flowratio,'—');assert.equal(unknown.nozzletemperature,'—');assert.equal(unknown.productid,'');assert.equal(unknown.remainingweight,'0');
});

test('substitution is literal, nonrecursive and safe for quotes, newlines, RGB properties and prototype-like names',async()=>{
  const m=await import('../static/label-templates.js'),template=m.exampleLabelTemplate('40x30');
  template.elements[0].text='$filamentname$ / $manufacturer$';template.elements[0].color='$filamentcolorrgb$';
  const result=m.instantiateLabelTemplate(template,{...spool,name:'A "quoted"\n$manufacturer$ spool'},link);
  assert.equal(result.elements[0].text,'A "quoted"\n$manufacturer$ spool / Bambu Lab');assert.equal(result.elements[0].color,'rgb(0, 0, 255)');
  template.elements[0].text='$constructor$';assert.throws(()=>m.importLabelTemplate(JSON.stringify(template),'40x30'),{code:'template_unknown_variable',variable:'constructor'});
});

test('invalid imports reject wrong sizes, unsupported variable fields, unsafe images and malformed structures before storage',async()=>{
  const m=await import('../static/label-templates.js');
  assert.throws(()=>m.importLabelTemplate(JSON.stringify(m.exampleLabelTemplate('40x30')),'60x40'),{code:'template_size_mismatch'});
  for(const source of ['null','[]','42','{}','{bad','x'.repeat(1024*1024+1)])assert.throws(()=>m.importLabelTemplate(source,'40x30'),{code:'template_invalid'});
  const changes=[t=>t.elements[0].id='$spoolid$',t=>t.elements[0].fontSize='$weight$',t=>t.elements[0].text='$unknown$',t=>t.elements.push({id:'external',type:'image',x:0,y:0,width:50,height:50,imageData:'https://example.com/logo.png'}),t=>t.elements[0].color='rgb(999, 0, 0)',t=>t.multiLabel={enabled:true}];
  for(const change of changes){const template=m.exampleLabelTemplate('40x30');change(template);assert.throws(()=>m.importLabelTemplate(JSON.stringify(template),'40x30'),error=>['template_invalid','template_unknown_variable'].includes(error.code));}
});

test('templates store independently per size, invalid replacements are atomic and removal preserves other templates',async()=>{
  const m=await import('../static/label-templates.js'),storage=memoryStorage();
  for(const size of ['40x30','60x40','70x80'])m.saveLabelTemplate(size,JSON.stringify(m.exampleLabelTemplate(size)),storage);
  assert.equal(storage.values.size,3);const before=storage.getItem('filamentdb.label-template.40x30');
  assert.throws(()=>m.saveLabelTemplate('40x30','{}',storage));assert.equal(storage.getItem('filamentdb.label-template.40x30'),before);
  m.removeLabelTemplate('60x40',storage);assert.equal(m.readLabelTemplate('60x40',storage),null);assert.ok(m.readLabelTemplate('40x30',storage));assert.ok(m.readLabelTemplate('70x80',storage));
  assert.equal(m.preferredLabelSize(storage),'70x80');storage.setItem('filamentdb.native-label-size','40x30');assert.equal(m.preferredLabelSize(storage),'40x30');
  const first=m.createSpoolLabel(spool,link,{size:'40x30'},{},storage);assert.equal(first.design.filamentdbTemplate.revision,first.template.revision);
  assert.equal(m.createSpoolLabel(spool,link,{size:'60x40'},{},storage).template,null);
});

test('quota failures preserve previous templates and corrupt storage is reported instead of silently printed',async()=>{
  const m=await import('../static/label-templates.js'),storage=memoryStorage();m.saveLabelTemplate('40x30',JSON.stringify(m.exampleLabelTemplate('40x30')),storage);
  const before=storage.getItem('filamentdb.label-template.40x30'),blocked={getItem:storage.getItem,setItem(){throw new Error('quota');}};
  assert.throws(()=>m.saveLabelTemplate('40x30',JSON.stringify(m.exampleLabelTemplate('40x30')),blocked),{code:'template_storage_failed'});assert.equal(storage.getItem('filamentdb.label-template.40x30'),before);
  storage.setItem('filamentdb.label-template.40x30','not JSON');assert.throws(()=>m.createSpoolLabel(spool,link,{size:'40x30'},{},storage),{code:'template_invalid'});
});

async function settingsUI(api=templateAPI()) {
  const storage=memoryStorage(),nodes=new Map(),downloads=[],draws=[];
  function node(key){if(!nodes.has(key))nodes.set(key,{getContext:()=>canvasContext(),hidden:key==='#label-templates-panel',value:'',setAttribute(name,value){this[name]=value;},querySelector:selector=>node(key+' '+selector)});return nodes.get(key);}
  function canvasContext(){const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(255)}),measureText:text=>({width:text.length*8})};for(const key of ['save','restore','translate','rotate','fillRect','fillText','rect','beginPath','clip','ellipse','fill','putImageData'])ctx[key]=(...args)=>{if(key==='fillText')draws.push(args[0]);};return ctx;}
  const context=vm.createContext({fetch:api.fetch,Uint8Array,Uint8ClampedArray,Float32Array,Blob,Intl,localStorage:storage,document:{querySelector:node,createElement:()=>({getContext:()=>canvasContext(),click(){},remove(){}}),body:{append(){}}},window:{location:{href:'https://filament.example/#qr-labels'},addEventListener(){}},URL:class extends URL {static createObjectURL(blob){downloads.push(blob);return 'blob:template';}static revokeObjectURL(){}},setTimeout:callback=>callback()});
  const graph=await loadFrontend(context,[],{entry:'label-template-settings.js',init:false});graph.get('i18n.js').configureI18n(JSON.parse(fs.readFileSync('static/locales/en.json','utf8')));graph.namespace.initLabelTemplateSettings();await node('#label-templates-open').onclick();
  const card=size=>node('#label-template-cards').querySelector('[data-label-template="'+size+'"]');
  const change=(size,text)=>node('#label-template-cards').onchange({target:{dataset:{templateImport:size},files:[{size:100,text:()=>typeof text==='function'?text():Promise.resolve(text)}],value:'file.json',disabled:false,closest:()=>card(size)}});
  const click=(size,action)=>node('#label-template-cards').onclick({target:{closest:()=>({disabled:false,dataset:{templateSize:size,templateAction:action},closest:()=>card(size)})}});
  return {storage,nodes,node,graph,card,change,click,downloads,api,draws,context};
}

test('QR template settings show three import slots and variable documentation, import/export/reset the correct size',async()=>{
  const ui=await settingsUI(),m=await import('../static/label-templates.js');
  assert.equal((ui.node('#label-template-cards').innerHTML.match(/data-label-template=/g)||[]).length,3);assert.match(ui.node('#label-template-variables').innerHTML,/\$filamentcolor\$/);
  for(const size of ['40x30','60x40','70x80'])await ui.change(size,JSON.stringify(m.exampleLabelTemplate(size)));
  assert.equal(ui.api.records.size,3);await ui.click('40x30','export');assert.deepEqual(JSON.parse(await ui.downloads.at(-1).text()),m.exampleLabelTemplate('40x30'));
  await ui.change('40x30',JSON.stringify(m.exampleLabelTemplate('60x40')));assert.match(ui.card('40x30').querySelector('[data-template-error]').textContent,/does not match/);
  assert.ok(ui.api.records.has('40x30'));await ui.click('60x40','remove');assert.equal(ui.api.records.has('60x40'),false);assert.ok(ui.api.records.has('70x80'));
  await ui.click('60x40','example');assert.deepEqual(JSON.parse(await ui.downloads.at(-1).text()).labelSize,{width:60,height:40});
});

test('removing a template invalidates an older pending file import',async()=>{
  const ui=await settingsUI(),m=await import('../static/label-templates.js');let finish;
  await ui.change('40x30',JSON.stringify(m.exampleLabelTemplate('40x30')));
  const pending=ui.change('40x30',()=>new Promise(resolve=>{finish=resolve;}));await ui.click('40x30','remove');finish(JSON.stringify(m.exampleLabelTemplate('40x30')));await pending;
  assert.equal(ui.api.records.has('40x30'),false);
});

test('reopening a saved template design refreshes unedited variables while retaining explicit text overrides',async()=>{
  const m=await import('../static/label-templates.js'),storage=memoryStorage();m.saveLabelTemplate('70x80',JSON.stringify(m.exampleLabelTemplate('70x80')),storage);
  const saved=m.createSpoolLabel(spool,link,{size:'70x80'},{},storage).design;
  saved.elements[0].text='My custom heading';
  const fresh=m.createSpoolLabel({...spool,name:'Renamed spool',remaining:200,color:'Red',color_hex:'#FF0000'},'https://new.example/#spool/permanent-42',{size:'70x80'},{},storage).design;
  const restored=m.restoreTemplateDesign(saved,fresh);
  assert.equal(restored.elements[0].text,'My custom heading');assert.equal(restored.elements.find(e=>e.id==='weight').text,'200 / 1000 g');assert.equal(restored.elements.find(e=>e.id==='color').text,'Red · #FF0000');assert.equal(restored.elements.find(e=>e.type==='qr').qrData,'https://new.example/#spool/permanent-42');
  assert.equal(restored.name,'Renamed spool · 70x80');assert.equal(saved.elements.find(e=>e.id==='weight').text,'430 / 1000 g');
});

test('all documented example files import for their size and the guide/catalogs cover every supported variable',async()=>{
  const m=await import('../static/label-templates.js'),guide=fs.readFileSync('docs/label-templates.md','utf8');
  const catalogs=['da','en'].map(lang=>JSON.parse(fs.readFileSync('static/locales/'+lang+'.json','utf8')).messages);
  for(const size of ['40x30','60x40','70x80'])assert.ok(m.importLabelTemplate(fs.readFileSync('docs/examples/label-template-'+size+'.json','utf8'),size));
  for(const variable of m.TEMPLATE_VARIABLES){assert.ok(guide.includes('`$'+variable+'$`'),variable);for(const catalog of catalogs)assert.ok(catalog['templates.var_'+variable],variable);}
});

test('separate clients load shared templates and stale writes cannot overwrite or delete them',async()=>{
  const api=templateAPI(),a=await settingsUI(api),b=await settingsUI(api),m=await import('../static/label-templates.js');
  await a.change('40x30',JSON.stringify(m.exampleLabelTemplate('40x30')));
  const storeB=b.graph.get('label-template-store.js');
  await assert.rejects(storeB.saveSharedLabelTemplate('40x30',JSON.stringify(m.exampleLabelTemplate('40x30'))),{code:'template_conflict'});
  await assert.rejects(storeB.removeSharedLabelTemplate('40x30'),{code:'template_conflict'});
  await storeB.loadSharedLabelTemplates();
  assert.equal(b.graph.get('label-templates.js').readLabelTemplate('40x30').revision,api.records.get('40x30').revision);
  await assert.rejects(storeB.saveSharedLabelTemplate('40x30',JSON.stringify(m.exampleLabelTemplate('40x30')),{onlyIfEmpty:true}),{code:'template_conflict'});
  assert.equal(api.records.size,1);
});

test('legacy templates transfer explicitly to an empty database slot and retain their original copy',async()=>{
  const ui=await settingsUI(),model=ui.graph.get('label-templates.js');
  model.saveLabelTemplate('60x40',JSON.stringify(model.exampleLabelTemplate('60x40')),ui.storage);
  const original=ui.storage.getItem('filamentdb.label-template.60x40');
  await ui.node('#label-template-reload').onclick();
  assert.match(ui.node('#label-template-cards').innerHTML,/data-template-action="migrate"/);
  await ui.click('60x40','migrate');assert.ok(ui.api.records.has('60x40'));
  assert.equal(ui.storage.getItem('filamentdb.label-template.60x40'),original);
  assert.match(ui.node('#label-template-cards').innerHTML,/data-template-action="migrate" data-template-size="60x40" disabled/);
});

test('template previews render all sizes with selected spool data, support search, and clear unmatched previews',async()=>{
  const ui=await settingsUI(),model=ui.graph.get('label-templates.js');
  for(const size of ['40x30','60x40','70x80'])await ui.change(size,JSON.stringify(model.exampleLabelTemplate(size)));
  ui.context.inventoryState.spools=[{...spool,label_token:'permanent-42'},{...spool,id:43,name:'Second spool',color:'Red',label_token:'permanent-43'}];
  await ui.graph.namespace.refreshLabelTemplateSpools();
  for(const size of ['40x30','60x40','70x80']){
    const canvas=ui.card(size).querySelector('[data-template-preview]'),[w,h]=size.split('x').map(Number);
    assert.equal(canvas.hidden,false);assert.equal(canvas.width,w*8);assert.equal(canvas.height,h*8);
    assert.match(ui.card(size).querySelector('[data-template-preview-status]').textContent,/#42/);
  }
  assert.ok(ui.draws.some(text=>text.includes('Blå')));
  ui.node('#label-template-preview-search').value='Second';await ui.node('#label-template-preview-search').oninput();
  assert.equal(ui.node('#label-template-spool').value,'43');assert.ok(ui.draws.some(text=>text.includes('Red')));
  ui.node('#label-template-preview-search').value='no such spool';await ui.node('#label-template-preview-search').oninput();
  for(const size of ['40x30','60x40','70x80'])assert.equal(ui.card(size).querySelector('[data-template-preview]').hidden,true);
});

test('appversion binds server metadata in previews and exports and refreshes saved bound fields',async()=>{
  const ui=await settingsUI(),m=ui.graph.get('label-templates.js');
  const template=m.exampleLabelTemplate('40x30');template.elements[0].text='Filament DB v$appversion$';
  await ui.change('40x30',JSON.stringify(template));
  ui.context.inventoryState.spools=[{...spool,label_token:'permanent-42'}];
  await ui.graph.namespace.refreshLabelTemplateSpools();
  assert.ok(ui.draws.includes('Filament DB v2.3.4'));
  const saved=m.createSpoolLabel(spool,link,{size:'40x30'}).design;
  assert.equal(saved.elements[0].text,'Filament DB v2.3.4');
  await ui.click('40x30','export');assert.equal(JSON.parse(await ui.downloads.at(-1).text()).elements[0].text,'Filament DB v$appversion$');
  m.setSharedLabelTemplates([...ui.api.records.values()],'2.3.5');
  const fresh=m.createSpoolLabel(spool,link,{size:'40x30'}).design;
  assert.equal(m.restoreTemplateDesign(saved,fresh).elements[0].text,'Filament DB v2.3.5');
  m.setSharedLabelTemplates([...ui.api.records.values()]);
  assert.equal(m.labelTemplateVariables(spool,link).appversion,'—');
});
