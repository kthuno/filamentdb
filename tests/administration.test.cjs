const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadFrontend}=require('./frontend-loader.cjs');

async function setup() {
  const nodes=new Map(),calls=[];
  let changed=0;
  const context=vm.createContext({Intl,confirm:()=>true,document:{querySelector(selector){
    if(!nodes.has(selector))nodes.set(selector,{value:'',disabled:false,hidden:false,innerHTML:'',textContent:'',attributes:{},setAttribute(key,value){this.attributes[key]=value;},focus(){}});
    return nodes.get(selector);
  }}});
  const graph=await loadFrontend(context,[],{entry:'administration.js',init:false});
  let records=[{name:'<Custom>',spool_count:0,project_count:0,in_use:false},{name:'PLA Basic',spool_count:2,project_count:1,in_use:true}];
  context.request=async(url,options)=>{
    calls.push([url,options]);
    if(url==='/api/system-status')return {database_online:true,response_ms:2,database:'sqlite'};
    if(url==='/api/version')return {version:'1.2.3',database:'sqlite'};
    if(!options)return records;
    const data=JSON.parse(options.body);
    if(options.method==='POST')records=[...records,{name:data.name,spool_count:0,project_count:0,in_use:false}];
    if(options.method==='PUT')records=records.map(item=>item.name===data.name?{...item,name:data.new_name}:item);
    if(options.method==='DELETE')records=records.filter(item=>item.name!==data.name);
    return {ok:true};
  };
  graph.namespace.initAdministration({onMaterialsChanged:async()=>{changed++;}});
  context.document.querySelector('#material-type-name');
  await graph.namespace.loadMaterialTypeAdmin();
  return {context,nodes,calls,admin:graph.namespace,get changed(){return changed;}};
}
function click(selector,key,index) { return {target:{closest:match=>match===selector?{dataset:{[key]:String(index)}}:null}}; }

test('material administration escapes names, shows usage, and refuses editing used types',async()=>{
  const ui=await setup(),html=ui.nodes.get('#material-type-list').innerHTML;
  assert.match(html,/&lt;Custom&gt;/);assert.doesNotMatch(html,/<Custom>/);
  assert.match(html,/Spoler: 2 · Projekter: 1/);
  assert.match(html,/data-material-edit="1" disabled/);
  await ui.nodes.get('#material-type-list').onclick(click('[data-material-edit]','materialEdit',1));
  assert.equal(ui.nodes.get('#material-type-name').value,'');
  assert.ok(ui.calls.every(([,options])=>!options));
});

test('material create, rename and confirmed deletion reload suggestions through the coordinator',async()=>{
  const ui=await setup();
  ui.nodes.get('#material-type-name').value='New blend';
  await ui.nodes.get('#material-type-form').onsubmit({preventDefault(){}});
  assert.equal(ui.changed,1);
  assert.match(ui.nodes.get('#material-type-list').innerHTML,/New blend/);
  await ui.nodes.get('#material-type-list').onclick(click('[data-material-edit]','materialEdit',0));
  ui.nodes.get('#material-type-name').value='Renamed blend';
  await ui.nodes.get('#material-type-form').onsubmit({preventDefault(){}});
  const rename=ui.calls.find(([,options])=>options?.method==='PUT')[1];
  assert.deepEqual(JSON.parse(rename.body),{name:'<Custom>',new_name:'Renamed blend'});
  assert.equal(ui.changed,2);
  ui.context.confirm=()=>false;
  await ui.nodes.get('#material-type-list').onclick(click('[data-material-delete]','materialDelete',0));
  assert.equal(ui.changed,2);
  ui.context.confirm=()=>true;
  await ui.nodes.get('#material-type-list').onclick(click('[data-material-delete]','materialDelete',0));
  assert.equal(ui.changed,3);
  assert.doesNotMatch(ui.nodes.get('#material-type-list').innerHTML,/Renamed blend/);
});

test('version information uses the running application endpoint for Administration and existing status',async()=>{
  const ui=await setup();
  for(const backend of ['sqlite','mysql']) {
    ui.context.request=async url=>url==='/api/system-status'?{database_online:true,response_ms:1,database:'sqlite'}:{version:'4.5.6',database:backend};
    await ui.admin.loadApplicationInfo();
    assert.equal(ui.nodes.get('#admin-app-version').textContent,'4.5.6');
    assert.equal(ui.nodes.get('#admin-database').textContent,backend==='mysql'?'MySQL':'SQLite');
    assert.match(ui.nodes.get('#app-version').textContent,/4.5.6/);
  }
  ui.context.request=async()=>{throw new Error('offline');};
  await ui.admin.loadApplicationInfo();
  assert.match(ui.nodes.get('#admin-info-error').textContent,/kunne ikke hentes/);
  assert.match(ui.nodes.get('#admin-app-version').textContent,/utilgængelig/);
  ui.context.request=async()=>({version:'4.5.7',database:'sqlite'});
  await ui.nodes.get('#admin-info-refresh').onclick();
  assert.equal(ui.nodes.get('#admin-app-version').textContent,'4.5.7');
  assert.equal(ui.nodes.get('#admin-info-error').textContent,'');
});

test('failed material writes preserve the form and show the server validation error',async()=>{
  const ui=await setup();
  ui.context.request=async()=>{throw new Error('Duplicate material');};
  ui.nodes.get('#material-type-name').value='PLA Basic';
  await ui.nodes.get('#material-type-form').onsubmit({preventDefault(){}});
  assert.equal(ui.nodes.get('#material-type-name').value,'PLA Basic');
  assert.equal(ui.nodes.get('#material-type-error').textContent,'Duplicate material');
  assert.equal(ui.nodes.get('#material-type-save').disabled,false);
  assert.equal(ui.changed,0);
});


test('Administration shortcuts scroll to visible cards without changing unfinished values',async()=>{
  const ui=await setup();
  const materials=ui.context.document.querySelector('#admin-materials');
  const language=ui.context.document.querySelector('#admin-language');
  let materialScrolls=0,languageScrolls=0;
  materials.scrollIntoView=()=>{materialScrolls++;};
  language.scrollIntoView=()=>{languageScrolls++;};
  ui.nodes.get('#material-type-name').value='Unfinished blend';
  ui.admin.openAdministrationSection('#admin/materials');
  ui.admin.openAdministrationSection('#admin/language');
  assert.equal(materialScrolls,1);
  assert.equal(languageScrolls,1);
  assert.equal(materials.open,undefined);
  assert.equal(language.open,undefined);
  assert.equal(ui.nodes.get('#material-type-name').value,'Unfinished blend');
  for(const unknown of ['#admin','#admin/unknown','#admin/constructor'])assert.doesNotThrow(()=>ui.admin.openAdministrationSection(unknown));
});

test('Administration groups visible cards and places language beside version/database',()=>{
  const fs=require('node:fs');
  const html=fs.readFileSync('static/index.html','utf8');
  const admin=html.slice(html.indexOf('<section id="admin-view"'),html.indexOf('<footer>'));
  assert.equal((admin.match(/class="admin-panel admin-scope-/g)||[]).length,5);
  assert.ok(!admin.includes('<details'));
  assert.ok(!admin.includes('<summary'));
  assert.equal((admin.match(/class="admin-card-header"/g)||[]).length,5);
  assert.equal((admin.match(/class="admin-group"/g)||[]).length,2);
  const overview=admin.slice(admin.indexOf('class="admin-overview-grid"'),admin.indexOf('<section id="admin-shared"'));
  assert.ok(overview.includes('id="admin-language"'));
  assert.ok(overview.includes('id="admin-info"'));
  for(const route of ['language','build-plates','materials','categories','info'])assert.ok(admin.includes('href="#admin/'+route+'"'));
});


test('SQLite diode reflects readability and does not hide version information',async()=>{
  const ui=await setup();
  await ui.admin.loadApplicationInfo();
  assert.equal(ui.nodes.get('#admin-db-state').attributes['data-state'],'online');
  assert.equal(ui.nodes.get('#admin-db-state-text').textContent,'Kan læses');
  assert.equal(ui.nodes.get('#admin-db-latency').textContent,'SELECT: 2 ms');
  assert.match(ui.nodes.get('#admin-db-checked').textContent,/Senest kontrolleret/);
  ui.context.request=async url=>{
    if(url==='/api/system-status')throw new Error('database down');
    return {version:'1.2.3',database:'sqlite'};
  };
  await ui.admin.loadApplicationInfo();
  assert.equal(ui.nodes.get('#admin-db-state').attributes['data-state'],'offline');
  assert.equal(ui.nodes.get('#admin-db-state-text').textContent,'Kan ikke læses');
  assert.equal(ui.nodes.get('#admin-app-version').textContent,'1.2.3');
  assert.equal(ui.nodes.get('#admin-database').textContent,'SQLite');
  assert.equal(ui.nodes.get('#admin-db-latency').textContent,'—');
});

test('a database refresh coalesces simultaneous requests and shows a neutral pending state',async()=>{
  const ui=await setup();
  let finish,calls=0;
  ui.context.request=async()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  const first=ui.admin.loadDatabaseStatus();
  const second=ui.admin.loadDatabaseStatus();
  assert.equal(calls,1);
  assert.equal(ui.nodes.get('#admin-db-state').attributes['data-state'],'checking');
  finish({database_online:true,response_ms:0,database:'sqlite'});
  await Promise.all([first,second]);
  assert.equal(ui.nodes.get('#admin-db-state').attributes['data-state'],'online');
});


test('database status is inside the database type card with no statistics boxes',()=>{
  const fs=require('node:fs');
  const html=fs.readFileSync('static/index.html','utf8');
  const databaseCard=html.match(/<dt data-i18n-text="0:admin.database">[\s\S]*?<\/dd><dd class="admin-database-details">([\s\S]*?)<\/dd>/);
  assert.ok(databaseCard);
  for(const id of ['admin-db-state','admin-db-latency','admin-db-checked'])assert.ok(databaseCard[1].includes('id="'+id+'"'));
  assert.ok(!html.includes('admin-db-stats'));
  assert.ok(!html.includes('admin-stat-'));
});
