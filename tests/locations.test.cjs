const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadFrontend}=require('./frontend-loader.cjs');

async function fixture(){
  const nodes=new Map(),requests=[];
  let loads=0;
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{value:'',dataset:{},hidden:false,innerHTML:'',textContent:'',addEventListener(){},classList:{toggle(){}},setAttribute(){},focus(){},showModal(){this.open=true;},close(){this.open=false;}});
    return nodes.get(selector);
  };
  const context=vm.createContext({Intl,URL,window:{location:{hash:'#locations'},addEventListener(){}},document:{querySelector:node},
    notify:()=>{},load:async()=>{loads++;},request:async(url,options)=>{requests.push({url,...options,body:JSON.parse(options.body)});return {ok:true};},
  });
  await loadFrontend(context);
  vm.runInContext(`inventoryState.locations=[{id:5,name:'AMS <1>',kind:'ams_2_pro'},{id:6,name:'Box',kind:'box'}];
    inventoryState.spools=[
      {id:1,name:'Current',material:'PLA',remaining:500,weight:1000,location_id:5,location_slot:1,location:'AMS <1> · slot 1'},
      {id:2,name:'Replacement',material:'PETG',remaining:750,weight:1000,location_id:6,location_slot:1,location:'Box'},
      {id:3,name:'Archived',material:'PLA',remaining:0,weight:1000,archived:1},
    ];`,context);
  return {context,node,requests,loads:()=>loads};
}
test('occupied and free AMS slots and box cards offer selection with separate edit buttons',async()=>{
  const {context}=await fixture();
  const ams=vm.runInContext('renderAmsLocation(inventoryState.locations[0])',context);
  assert.equal((ams.match(/data-select-slot=/g)||[]).length,4);
  assert.match(ams,/data-select-location="5"/);
  assert.match(ams,/data-open-spool="1">Redigér spole/);
  let depth=0;
  for(const tag of ams.match(/<button\b[^>]*>|<\/button>/g)||[]) {
    depth+=tag.startsWith('</')?-1:1;
    assert.ok(depth===0 || depth===1,'buttons must not be nested');
  }
  assert.equal(depth,0);
  const box=vm.runInContext('renderDryBoxLocation(inventoryState.locations[1])',context);
  assert.match(box,/data-select-slot="1"/);
  assert.match(box,/data-open-spool="2">Redigér spole/);
});
test('card background chooses a free slot and selection writes only on save',async()=>{
  const {context,node,requests,loads}=await fixture();
  await node('#location-list').onclick({target:{closest:selector=>selector==='[data-select-location]'?{dataset:{selectLocation:'5'}}:null}});
  assert.equal(node('#location-content-dialog').open,true);
  assert.equal(node('#location-content-slot').value,'2');
  assert.equal(node('#location-content-spool').value,'');
  assert.equal(requests.length,0);
  assert.doesNotMatch(node('#location-content-spool').innerHTML,/Archived/);
  node('#location-content-spool').value='2';
  node('#location-content-spool').onchange();
  assert.match(node('#location-content-change').textContent,/Box/);
  await node('#location-content-form').onsubmit({preventDefault(){}});
  assert.deepEqual(requests[0].body,{slot:2,filament_id:2,expected_filament_id:null});
  assert.equal(requests[0].url,'/api/locations/5/contents');
  assert.equal(requests[0].method,'PUT');
  assert.equal(node('#location-content-dialog').open,false);
  assert.equal(loads(),2);
});
test('search preserves current selection and stale-content errors keep the dialog editable',async()=>{
  const {context,node,requests}=await fixture();
  await vm.runInContext('openLocationContents(5,1)',context);
  assert.equal(node('#location-content-spool').value,'1');
  node('#location-content-search').value='does not match';
  node('#location-content-search').oninput();
  assert.equal(node('#location-content-spool').value,'1');
  assert.equal(node('#location-content-save').disabled,true);
  node('#location-content-spool').value='';
  node('#location-content-spool').onchange();
  assert.match(node('#location-content-change').textContent,/flyttes til lager/);
  context.request=async()=>{throw new Error('Pladsens indhold er ændret.');};
  await node('#location-content-form').onsubmit({preventDefault(){}});
  assert.equal(node('#location-content-dialog').open,true);
  assert.match(node('#location-content-error').textContent,/ændret/);
  assert.equal(node('#location-content-spool').disabled,false);
  assert.equal(node('#location-content-save').disabled,false);
  node('#location-content-cancel').onclick();
  assert.equal(node('#location-content-dialog').open,false);
  assert.equal(requests.length,0);
});
