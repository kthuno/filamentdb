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
  const nodes=new Map(),events=new Map(),cards=new Map();
  function node(selector) {
    if(!nodes.has(selector))nodes.set(selector,{value:'',dataset:{},hidden:['#label-gallery','#native-labels-panel','#all-labels-panel','#label-templates-panel'].includes(selector),open:false,
      setAttribute(name,value){this[name]=value;},scrollIntoView(){},addEventListener(){},
      querySelector(selector){
        const id=selector.match(/\[data-gallery-id="(\d+)"\]/)?.[1];
        if(id){
          if(!cards.has(id))cards.set(id,{dataset:{galleryId:id},fields:new Map(),querySelector(key){if(!this.fields.has(key))this.fields.set(key,{value:'',textContent:'',innerHTML:''});return this.fields.get(key);},querySelectorAll(){return [{dataset:{galleryAction:'download'}},{dataset:{galleryAction:'print'}},{dataset:{galleryAction:'guide'}}];}});
          return cards.get(id);
        }
        return node(selector);
      },
    });
    return nodes.get(selector);
  }
  const context=vm.createContext({URL,URLSearchParams,Intl,fetch,window:{location:{href:'https://filament.example/#qr-labels'},addEventListener:(name,callback)=>events.set(name,callback)},document:{querySelector:node}});
  const graph=await loadFrontend(context,[],{entry:'labels.js',init:false});context.inventoryState.spools=records;graph.namespace.initLabels();node('#qr-labels-view').hidden=false;
  await graph.namespace.refreshLabels();
  const ids=(selector,attribute)=>[...(node(selector).innerHTML||'').matchAll(new RegExp(attribute+'="(\\d+)"','g'))].map(match=>Number(match[1]));
  return {nodes,context,graph,cards,events,node,ids,
    async search(text){node('#label-search').value=text;await node('#label-search').oninput();},
    edit(id,field,value){const card=node('#label-gallery').querySelector('[data-gallery-id="'+id+'"]');node('#label-gallery').oninput({target:{dataset:{galleryField:field},value,closest:()=>card}});},
  };
}
function profile() {
  const source=JSON.parse(fs.readFileSync('src/reference/bambu_filament_guide.json','utf8'));
  return {...source.profiles.find(item=>item.material==='PAHT-CF'),source_url:source.source_url};
}

test('label actions and the old dialog are absent from spools; QR workspace owns three collapsible workflows',()=>{
  const html=fs.readFileSync('static/index.html','utf8'),inventory=fs.readFileSync('static/inventory.js','utf8');
  assert.ok(!html.includes('id="label-dialog"'));assert.ok(!html.includes('id="native-label-open"'));
  assert.ok(!inventory.includes('data-label'));assert.ok(!inventory.includes('openLabel'));assert.ok(inventory.includes('data-consume'));
  const view=html.slice(html.indexOf('<section id="qr-labels-view"'),html.indexOf('<section id="admin-view"'));
  for(const id of ['label-gallery-panel','native-labels-section','a4-labels-section','label-search','label-material-filter','label-manufacturer-filter'])assert.ok(view.includes('id="'+id+'"'));
  assert.match(view,/id="native-labels-open"[^>]*aria-expanded="false"/);
  assert.ok(view.includes('id="native-labels-panel" hidden'));
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

test('shared filters reset both paginated lists, include archived rolls and leave A4 selection alone',async()=>{
  const ui=await workspace();
  await ui.node('#label-gallery-open').onclick();ui.node('#native-labels-open').onclick();
  assert.equal(ui.ids('#label-gallery','data-gallery-id').length,12);assert.equal(ui.ids('#native-label-list','data-native-spool').length,12);
  assert.match(ui.node('#native-labels-count').textContent,/40 af 40.*1\/4/);
  const first=ui.ids('#label-gallery','data-gallery-id');await ui.node('#label-gallery-next').onclick();assert.ok(ui.ids('#label-gallery','data-gallery-id').every(id=>!first.includes(id)));
  ui.node('#all-labels-open').onclick();const sheet=ui.node('#selected-labels-pages').innerHTML;
  await ui.search('#0040');assert.deepEqual(ui.ids('#label-gallery','data-gallery-id'),[40]);assert.deepEqual(ui.ids('#native-label-list','data-native-spool'),[40]);assert.match(ui.node('#native-label-list').innerHTML,/Arkiveret/);
  assert.equal(ui.node('#selected-labels-pages').innerHTML,sheet);assert.equal(ui.node('#native-labels-next').disabled,true);assert.equal(ui.node('#label-gallery-previous').disabled,true);
  await ui.node('#label-filters-reset').onclick();assert.equal(ui.ids('#native-label-list','data-native-spool').length,12);
  ui.node('#label-material-filter').value='PLA';await ui.node('#label-material-filter').oninput();assert.match(ui.node('#label-filter-summary').textContent,/20 af 40/);
  await ui.search('not present');assert.match(ui.node('#native-label-list').innerHTML,/Ingen spoler matcher/);assert.match(ui.node('#label-gallery').innerHTML,/Ingen spoler matcher/);
});

test('gallery edits survive filters, pagination, collapse and inventory refresh; data remains escaped',async()=>{
  const records=spools();records[0].name='<unsafe>';records[0].manufacturer='<img onerror=x>';records[0].color_hex='red;background:url(unsafe)';records[0].transparency='transparent';
  const ui=await workspace(records);await ui.node('#label-gallery-open').onclick();ui.node('#native-labels-open').onclick();
  assert.match(ui.node('#native-label-list').innerHTML,/&lt;unsafe&gt;/);assert.ok(!ui.node('#native-label-list').innerHTML.includes('<img onerror'));
  assert.match(ui.node('#native-label-list').innerHTML,/class="spool transparent-spool"/);
  assert.match(ui.node('#native-label-list').innerHTML,/--spool:#bd93f9;/);
  assert.ok(!ui.node('#native-label-list').innerHTML.includes('url(unsafe)'));
  const id=ui.ids('#label-gallery','data-gallery-id')[0];ui.edit(id,'nozzle','275°C');
  await ui.node('#label-gallery-next').onclick();await ui.node('#label-gallery-previous').onclick();
  assert.match(ui.cards.get(String(id)).querySelector('.gallery-preview').innerHTML,/275°C/);
  await ui.search('no match');await ui.search('');
  await ui.node('#label-gallery-open').onclick();assert.equal(ui.node('#label-gallery').hidden,true);await ui.node('#label-gallery-open').onclick();
  assert.match(ui.cards.get(String(id)).querySelector('.gallery-preview').innerHTML,/275°C/);
  ui.context.inventoryState.spools=records.map(s=>({...s,nozzle_temp:220}));await ui.graph.namespace.refreshLabels();
  assert.match(ui.cards.get(String(id)).querySelector('.gallery-preview').innerHTML,/275°C/);assert.equal(records.find(s=>s.id===id).nozzle_temp,undefined);
});

test('profile lookups are lazy, cached, limited to four and cannot replace a newer filtered page',async()=>{
  const records=spools();for(let i=0;i<12;i++)records[i]={...records[i],manufacturer:'Bambu Lab',material:'Material '+i};records[16].name='Unique target';
  const pending=[];let requests=0,active=0,maximum=0;
  const ui=await workspace(records,()=>{requests++;active++;maximum=Math.max(maximum,active);return new Promise(resolve=>pending.push(()=>{active--;resolve({ok:true,json:async()=>null});}));});
  assert.equal(requests,0);const opening=ui.node('#label-gallery-open').onclick();await tick();assert.equal(requests,4);
  await ui.search('Unique target');assert.deepEqual(ui.ids('#label-gallery','data-gallery-id'),[17]);
  while(requests<12 || pending.length){pending.splice(0).forEach(resolve=>resolve());await tick();}
  await opening;assert.equal(maximum,4);assert.deepEqual(ui.ids('#label-gallery','data-gallery-id'),[17]);
  await ui.search('');assert.equal(requests,12); // Same profile requests are reused.
});

test('guide choices and manual overrides are available in gallery cards after removing the old dialog',async()=>{
  let finish;const record={...spools(1)[0],manufacturer:'Bambu Lab',material:'PAHT CF',nozzle_temp:270};
  const ui=await workspace([record],()=>new Promise(resolve=>{finish=resolve;}));const opening=ui.node('#label-gallery-open').onclick();await tick();ui.edit(1,'nozzle','275°C');
  finish({ok:true,json:async()=>profile()});await opening;
  const card=ui.cards.get('1');assert.match(card.querySelector('.gallery-preview').innerHTML,/275°C/);assert.match(card.querySelector('.gallery-guide').innerHTML,/Textured PEI Plate/);
  ui.edit(1,'dryingMethod','1');assert.match(card.querySelector('.gallery-preview').innerHTML,/90–100°C\/12h/);assert.match(card.querySelector('.gallery-guide').innerHTML,/vend det halvvejs/);
  const guide={dataset:{galleryAction:'guide'},closest:()=>card};await ui.node('#label-gallery').onclick({target:{closest:()=>guide}});
  assert.match(card.querySelector('.gallery-preview').innerHTML,/260–300°C/);assert.equal(record.nozzle_temp,270);
});

test('native spool action uses the selected identity and cached manual profile values',async()=>{
  const ui=await workspace();await ui.node('#label-gallery-open').onclick();ui.node('#native-labels-open').onclick();ui.edit(3,'nozzle','225°C');
  const opened=[];ui.context.openNativeLabelPrinter=(...args)=>opened.push(args);
  const status={},card={querySelector:()=>status},button={dataset:{openNative:'3'},disabled:false,closest:()=>card};
  await ui.node('#native-label-list').onclick({target:{closest:()=>button}});
  assert.equal(opened.length,1);assert.equal(opened[0][0].id,3);assert.equal(opened[0][1],'https://filament.example/#spool/unique-3');assert.equal(opened[0][2].nozzle,'225°C');assert.equal(button.disabled,false);
});

test('browser printing uses only the selected gallery SVG, clears after printing and does not open a dialog',async()=>{
  const ui=await workspace(spools(2));await ui.node('#label-gallery-open').onclick();ui.node('#all-labels-open').onclick();ui.edit(1,'nozzle','235°C');
  let prints=0;ui.context.window.print=()=>{prints++;ui.events.get('beforeprint')();assert.equal(ui.node('#single-label-print').dataset.printActive,'true');assert.equal(ui.node('#selected-labels-pages').dataset.printActive,'false');};
  const card=ui.cards.get('1'),button={dataset:{galleryAction:'print'},disabled:false,closest:()=>card};
  await ui.node('#label-gallery').onclick({target:{closest:()=>button}});assert.equal(prints,1);assert.match(ui.node('#single-label-print').innerHTML,/235°C/);assert.match(ui.node('#label-print-page-style').textContent,/60mm 40mm/);
  ui.events.get('afterprint')();assert.equal(ui.node('#single-label-print').innerHTML,'');assert.equal(ui.node('#label-print-page-style').textContent,'');assert.equal(ui.graph.namespace.openLabel,undefined);
});

test('only the latest native spool selection opens after a slow shared lookup',async()=>{
  const records=spools(2).map(s=>({...s,manufacturer:'Bambu Lab',material:'PLA Basic'}));
  let finish,requests=0;const ui=await workspace(records,()=>{requests++;return new Promise(resolve=>{finish=resolve;});});ui.node('#native-labels-open').onclick();
  const opened=[];ui.context.openNativeLabelPrinter=(spool)=>opened.push(spool.id);
  const click=id=>{const status={},button={dataset:{openNative:String(id)},disabled:false,closest:()=>({querySelector:()=>status})};return {button,promise:ui.node('#native-label-list').onclick({target:{closest:()=>button}})};};
  const first=click(1),second=click(2);await tick();assert.equal(requests,1);finish({ok:true,json:async()=>null});await Promise.all([first.promise,second.promise]);
  assert.deepEqual(opened,[2]);assert.equal(first.button.disabled,false);assert.equal(second.button.disabled,false);
});

test('profile failures preserve manual gallery printing and native spool temperatures',async()=>{
  const records=spools(1).map(s=>({...s,manufacturer:'Bambu Lab',material:'Unknown',nozzle_temp:270,bed_temp:90}));
  const ui=await workspace(records,async()=>{throw new Error('offline');});await ui.node('#label-gallery-open').onclick();ui.node('#native-labels-open').onclick();
  const card=ui.cards.get('1');assert.match(card.querySelector('.gallery-preview').innerHTML,/270°C/);assert.match(card.querySelector('.gallery-status').textContent,/kunne ikke hentes/);
  const opened=[];ui.context.openNativeLabelPrinter=(...args)=>opened.push(args);
  const button={dataset:{openNative:'1'},disabled:false,closest:()=>({querySelector:()=>({})})};await ui.node('#native-label-list').onclick({target:{closest:()=>button}});
  assert.equal(opened[0][2].nozzle,'270°C');assert.equal(opened[0][2].bed,'90°C');assert.equal(button.disabled,false);
});
