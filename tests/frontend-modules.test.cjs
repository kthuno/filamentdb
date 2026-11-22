const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {loadFrontend} = require('./frontend-loader.cjs');

test('pure consumption calculations are directly importable without DOM or globals', async () => {
  const {summarizeUsage} = await import('../static/usage-model.js');
  const result = summarizeUsage([
    {id:1,print_id:9,print_date:'2026-11-01',duration_minutes:60,grams:100,material:'PLA'},
    {id:2,print_id:9,print_date:'2026-11-01',duration_minutes:60,grams:25,material:'PLA'},
    {id:3,waste_id:2,waste_date:'2026-11-02',waste_reason:'purge',grams:10,material:'PLA'},
  ],'2026');
  assert.equal(result.grams,135);
  assert.equal(result.printMinutes,60);
  assert.equal(result.registrations,2);
  assert.equal(result.wasteGrams,10);
});

test('store protects snapshots and preserves the entire previous snapshot on failed refresh', async () => {
  let offline=false;
  const context=vm.createContext({fetch:async url=>{
    if(offline && url==='/api/locations') throw new Error('offline');
    return {ok:true,json:async()=>url==='/api/material-types'?['PLA']:[{id:offline?99:1,name:'Test'}]};
  }});
  const {namespace:store}=await loadFrontend(context,[],{entry:'inventory-data.js',init:false,exposeInternals:false});
  await store.fetchInventory();
  const previous=store.inventoryState.spools;
  assert.equal(Reflect.set(store.inventoryState,'spools',[]),false);
  assert.throws(()=>{store.inventoryState.spools.push({id:2});},TypeError);
  assert.equal(Object.isFrozen(store.inventoryState.spools[0]),true);
  offline=true;
  await assert.rejects(store.fetchInventory(),/offline/);
  assert.equal(store.inventoryState.spools,previous);
  assert.equal(store.inventoryState.locations[0].id,1);
  assert.equal(store.inventoryState.materialTypes[0],'PLA');
  assert.equal('inventorySnapshot' in store,false);
});

function browserFixture(hash='') {
  const nodes=new Map(), events=[], calls=[];
  const location={hash,href:'http://localhost/'};
  const document={querySelector(selector) {
    if(!nodes.has(selector))nodes.set(selector,{value:'',innerHTML:'',textContent:'',dataset:{},addEventListener(){},classList:{toggle(){}},setAttribute(){},removeAttribute(){},reset(){},focus(){},showModal(){this.open=true;},close(){this.open=false;}});
    const element=nodes.get(selector);
    if(selector==='#consumption-spool' && !element.selectionReady) {
      element.selectionReady=true;
      let markup='';
      Object.defineProperty(element,'innerHTML',{get:()=>markup,set(value) {
        markup=value;
        const selected=value.match(/<option value="([^"]+)" selected/);
        if(selected)element.value=selected[1];
      }});
    }
    return element;
  }};
  const payloads={
    '/locales/index.json':JSON.parse(fs.readFileSync('static/locales/index.json','utf8')),
    '/locales/da.json':JSON.parse(fs.readFileSync('static/locales/da.json','utf8')),
    '/api/filaments':[{id:1,name:'PLA',label_token:'stable',material:'PLA',color:'Sort',color_hex:'#000000',weight:1000,remaining:500,diameter:1.75,purchase_format:'spool'}],
    '/api/locations':[], '/api/material-types':['PLA'],
    '/api/consumption':[{id:1,filament_id:1,name:'PLA',material:'PLA',grams:20,created_at:'2026-11-01 10:00:00'}],
    '/api/filaments/1/consumption':[],
    '/api/version':{version:'1.2.3',database:'sqlite'},
    '/api/files':[], '/api/build-plates':[], '/api/projects':[],
    '/api/knowledge-categories':[], '/api/knowledge-tags':[], '/api/prints':[],
    '/api/knowledge?':[],
    '/api/planning':{products:[],needs:[],unresolved:[],wishes:[],estimate_warnings:[],summary:{projects:0,known_grams:0,shortage_grams:0}},
  };
  const context=vm.createContext({Intl,URL,URLSearchParams,document,location,
    window:{location,addEventListener:(...args)=>events.push(args),matchMedia:()=>({matches:false,addEventListener(){}})},
    fetch:async url=>{calls.push(url);assert.ok(url in payloads,url);return {ok:true,json:async()=>structuredClone(payloads[url])};},
  });
  return {context,nodes,events,calls,payloads};
}

test('ES-module entry starts dashboard and all imports without leaking globals', async () => {
  const {context,nodes,events,calls}=browserFixture();
  const html=fs.readFileSync('static/index.html','utf8');
  assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map(m=>m[1]),['/bootstrap.js']);
  assert.match(html,/<script type="module" src="\/bootstrap.js"><\/script>/);
  const graph=await loadFrontend(context,[],{init:false,exposeInternals:false});
  assert.equal(calls.length,0,'module evaluation does not start requests');
  assert.equal(context.inventoryState,undefined);
  assert.equal(context.PrintEditor,undefined);
  assert.equal(context.request,undefined);
  assert.equal('printDraft' in graph.get('prints.js'),false);
  assert.equal('labelRecords' in graph.get('labels.js'),false);
  assert.equal('selectedLabelIds' in graph.get('labels.js'),false);
  await graph.namespace.startApp();
  assert.equal(nodes.get('#dashboard-view').hidden,false);
  assert.equal(nodes.get('#archive-view').hidden,true);
  assert.equal(nodes.get('#total').textContent,1);
  assert.match(nodes.get('#cards').innerHTML,/PLA/);
  assert.match(nodes.get('#usage-statistics-summary').innerHTML,/20/);
  assert.equal(nodes.get('#app-version').textContent,'Filament DB v1.2.3');
  graph.namespace.initApp();
  assert.equal(events.filter(([event])=>event==='hashchange').length,1);
  const visit=(module,ancestors=[])=>{
    assert.ok(!ancestors.includes(module.identifier),'circular import: '+module.identifier);
    for(const specifier of module.dependencySpecifiers){
      visit(graph.modules.get(path.resolve(path.dirname(module.identifier),specifier)),[...ancestors,module.identifier]);
    }
  };
  visit(graph.modules.get(path.resolve('static/app.js')));
});

test('deep links initialize their feature once after imports have resolved', async () => {
  for(const [hash,endpoint] of [
    ['#files','/api/files'],['#build-plates','/api/build-plates'],
    ['#projects','/api/projects'],['#knowledge','/api/knowledge-categories'],
    ['#spool/stable','/api/filaments/1/consumption'],
  ]){
    const {context,nodes,calls}=browserFixture(hash);
    const {namespace}=await loadFrontend(context,[],{init:false,exposeInternals:false});
    await namespace.startApp();
    assert.equal(calls.filter(url=>url===endpoint).length,1,hash);
    for(const id of ['#files-error','#projects-error','#knowledge-error','#build-plate-error']){
      assert.ok(!nodes.get(id)?.textContent,hash+': '+nodes.get(id)?.textContent);
    }
    if(hash.startsWith('#spool/'))assert.equal(nodes.get('#consumption-dialog').open,true);
  }
});

test('dashboard print errors stay visible on dashboard and release the button', async () => {
  const {context,nodes}=browserFixture();
  await loadFrontend(context,[],{exposeInternals:false});
  context.fetch=async()=>{throw new Error('offline');};
  await nodes.get('#dashboard-print').onclick();
  assert.equal(nodes.get('#dashboard-error').textContent,'offline');
  assert.equal(nodes.get('#dashboard-print').disabled,false);
});
