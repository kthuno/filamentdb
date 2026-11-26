const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {loadFrontend}=require('./frontend-loader.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function spools(count=40) {
  return Array.from({length:count},(_,i)=>({id:i+1,label_token:'unique-'+(i+1),name:'Spool '+(i+1),manufacturer:'Other',material:i%2?'PETG':'PLA',color:i%2?'Black':'Blå',color_hex:i%2?'#000000':'#0000ff',location:'Box',weight:1000,remaining:500,product_id:'SKU-'+(i+1),archived:i===count-1}));
}
async function workspace(records=spools(),fetch=async()=>{throw new Error('unexpected request');}) {
  const nodes=new Map(),events=new Map();
  function node(selector) {
    if(!nodes.has(selector))nodes.set(selector,{value:'',dataset:{},hidden:['#native-labels-panel','#all-labels-panel','#label-templates-panel'].includes(selector),open:false,
      setAttribute(name,value){this[name]=value;},scrollIntoView(){},addEventListener(){},querySelector:node});return nodes.get(selector);
  }
  node('#qr-labels-view').hidden=false;
  const context=vm.createContext({console,fetch,Intl,Blob,URL,URLSearchParams,document:{querySelector:node},window:{location:{href:'https://filament.example/#qr-labels'},addEventListener:(name,callback)=>events.set(name,callback),print(){}}});
  const graph=await loadFrontend(context,[],{entry:'labels.js',init:false});context.inventoryState.spools=records;context.inventoryState.locations=[];graph.namespace.initLabels();
  const ids=(selector,attribute)=>[...node(selector).innerHTML.matchAll(new RegExp(attribute+'="(\\d+)"','g'))].map(m=>Number(m[1]));
  const opened=[];context.openNativeLabelPrinter=(...args)=>opened.push(args);
  const open=id=>{const status={},button={dataset:{openNative:String(id)},disabled:false,closest:()=>({querySelector:()=>status})};return {button,status,promise:node('#native-label-list').onclick({target:{closest:()=>button}})};};
  return {context,graph,node,events,ids,opened,open,async search(value){node('#label-search').value=value;await node('#label-search').oninput();}};
}

test('QR workspace contains designer printing, A4 and templates without the obsolete image gallery or print container',()=>{
  const html=fs.readFileSync('static/index.html','utf8');
  for(const id of ['native-labels-section','a4-labels-section','label-templates-section','label-search'])assert.ok(html.includes('id="'+id+'"'));
  for(const id of ['label-gallery','label-gallery-panel','single-label-print','label-print-page-style'])assert.ok(!html.includes('id="'+id+'"'));
  assert.ok(!fs.existsSync('static/thermal-labels.js'));
});

test('local filtering combines terms and exact material/manufacturer filters, including Danish text and spool identities',async()=>{
  const {filterLabelSpools,labelListPage}=await import('../static/label-list-model.js');
  const records=spools(1500);records[41]={...records[41],name:'Blå test',material:'PLA Matte',manufacturer:'Bambu Lab',location:'Skuffe Øst',product_id:'AB-42'};
  assert.deepEqual(filterLabelSpools(records,{search:'bla BAMBU ab-42 skuffe oest',material:'PLA Matte',manufacturer:'Bambu Lab'}).map(s=>s.id),[42]);
  assert.deepEqual(filterLabelSpools(records,{search:'#0042'}).map(s=>s.id),[42]);
  assert.equal(filterLabelSpools(records,{search:'#0042',material:'PETG'}).length,0);
  assert.equal(labelListPage(records,999).records.length,12);assert.equal(labelListPage(records,999).index,124);
  assert.equal(labelListPage([],5).pages,1);assert.equal(labelListPage(records,-2).index,0);assert.equal(records.length,1500);
});


test('native filters and pagination include archived rolls without changing A4 selection',async()=>{
  const ui=await workspace();ui.node('#native-labels-open').onclick();assert.equal(ui.ids('#native-label-list','data-native-spool').length,12);
  const first=ui.ids('#native-label-list','data-native-spool');ui.node('#native-labels-next').onclick();assert.ok(ui.ids('#native-label-list','data-native-spool').every(id=>!first.includes(id)));
  ui.node('#all-labels-open').onclick();const sheet=ui.node('#selected-labels-pages').innerHTML;
  await ui.search('#0040');assert.deepEqual(ui.ids('#native-label-list','data-native-spool'),[40]);assert.match(ui.node('#native-label-list').innerHTML,/Arkiveret/);
  assert.equal(ui.node('#selected-labels-pages').innerHTML,sheet);assert.equal(ui.node('#native-labels-next').disabled,true);assert.equal(ui.node('#native-labels-previous').disabled,true);
  await ui.node('#label-filters-reset').onclick();assert.equal(ui.ids('#native-label-list','data-native-spool').length,12);
  ui.node('#label-material-filter').value='PLA';await ui.node('#label-material-filter').oninput();assert.match(ui.node('#label-filter-summary').textContent,/20 af 40/);
  await ui.search('not present');assert.match(ui.node('#native-label-list').innerHTML,/Ingen spoler matcher/);
});

test('native cards escape user content and retain inventory spool styling',async()=>{
  const records=spools();Object.assign(records[0],{name:'<unsafe>',manufacturer:'<img onerror=x>',color_hex:'red;background:url(unsafe)',transparency:'transparent'});
  const ui=await workspace(records);ui.node('#native-labels-open').onclick();const html=ui.node('#native-label-list').innerHTML;
  assert.match(html,/&lt;unsafe&gt;/);assert.ok(!html.includes('<img onerror'));assert.match(html,/class="spool transparent-spool"/);assert.match(html,/--spool:#bd93f9;/);assert.ok(!html.includes('url(unsafe)'));
});

test('profiles remain lazy, share cached lookups and limit concurrent native requests to four',async()=>{
  const records=spools(12).map((spool,i)=>({...spool,manufacturer:'Bambu Lab',material:'Material '+i}));
  const pending=[];let requests=0,active=0,maximum=0;
  const ui=await workspace(records,()=>{requests++;active++;maximum=Math.max(maximum,active);return new Promise(resolve=>pending.push(()=>{active--;resolve({ok:true,json:async()=>null});}));});
  ui.node('#native-labels-open').onclick();assert.equal(requests,0);
  const attempts=records.map(spool=>ui.open(spool.id));await tick();assert.equal(requests,4);
  while(requests<12||pending.length){pending.splice(0).forEach(resolve=>resolve());await tick();}
  await Promise.all(attempts.map(a=>a.promise));assert.equal(maximum,4);assert.deepEqual(ui.opened.map(args=>args[0].id),[12]);
  await ui.open(1).promise;assert.equal(requests,12);
});

test('native designs and template previews receive the same cached guide values',async()=>{
  const records=spools(2).map(spool=>({...spool,manufacturer:'Bambu Lab',material:'PLA Basic'}));let requests=0;
  const profile={material:'PLA Basic',nozzle_temperature_c:[190,230],bed_temperatures:[{plate:'Other',temperature_c:[30,40]},{plate:'Textured PEI Plate',temperature_c:[55,65]}],flow_ratio:0.96,drying_conditions:[{temperature_c:[50,50],hours:[8,8]}]};
  const ui=await workspace(records,async()=>{requests++;return {ok:true,json:async()=>profile};});ui.node('#native-labels-open').onclick();await ui.open(1).promise;
  assert.equal(ui.opened[0][1],'https://filament.example/#spool/unique-1');assert.equal(ui.opened[0][2].nozzle,'190–230°C');assert.equal(ui.opened[0][2].bed,'55–65°C');assert.equal(ui.opened[0][2].drying,'50°C/8h');
  const preview=await ui.context.templateProfileForSpool(records[1]);assert.equal(preview.flow,'0.96');assert.equal(preview.bed,'55–65°C');assert.equal(requests,1);
});

test('only the latest native spool selection opens after a slow shared lookup',async()=>{
  const records=spools(2).map(spool=>({...spool,manufacturer:'Bambu Lab',material:'PLA Basic'}));let finish,requests=0;
  const ui=await workspace(records,()=>{requests++;return new Promise(resolve=>{finish=resolve;});});ui.node('#native-labels-open').onclick();
  const first=ui.open(1),second=ui.open(2);await tick();assert.equal(requests,1);finish({ok:true,json:async()=>null});await Promise.all([first.promise,second.promise]);
  assert.deepEqual(ui.opened.map(args=>args[0].id),[2]);assert.equal(first.button.disabled,false);assert.equal(second.button.disabled,false);
});

test('profile failures preserve native spool temperatures',async()=>{
  const records=spools(1).map(spool=>({...spool,manufacturer:'Bambu Lab',material:'Unknown',nozzle_temp:270,bed_temp:90}));
  const ui=await workspace(records,async()=>{throw new Error('offline');});ui.node('#native-labels-open').onclick();const attempt=ui.open(1);await attempt.promise;
  assert.equal(ui.opened[0][2].nozzle,'270°C');assert.equal(ui.opened[0][2].bed,'90°C');assert.equal(attempt.button.disabled,false);
});

test('A4 print lifecycle respects the active page and native dialog after gallery removal',async()=>{
  const ui=await workspace(spools(2));ui.node('#all-labels-open').onclick();ui.events.get('beforeprint')();assert.equal(ui.node('#selected-labels-pages').dataset.printActive,'true');
  ui.events.get('afterprint')();assert.equal(ui.node('#selected-labels-pages').dataset.printActive,'false');
  ui.node('#native-label-dialog').open=true;ui.events.get('beforeprint')();assert.equal(ui.node('#selected-labels-pages').dataset.printActive,'false');
  ui.node('#native-label-dialog').open=false;ui.node('#qr-labels-view').hidden=true;ui.events.get('beforeprint')();assert.equal(ui.node('#selected-labels-pages').dataset.printActive,'false');
});
