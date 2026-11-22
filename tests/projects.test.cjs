const {test, before} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodes = new Map();
function node(selector) {
  if (!nodes.has(selector)) nodes.set(selector,{value:'',dataset:{},hidden:false,addEventListener(){},classList:{toggle(){}},setAttribute(){},removeAttribute(){},focus(){},reset(){},showModal(){this.open=true;},close(){this.open=false;}});
  return nodes.get(selector);
}
const context = vm.createContext({Intl,URL,window:{location:{hash:''},addEventListener(){}},document:{querySelector:node,querySelectorAll:()=>[]}});
const {loadFrontend} = require('./frontend-loader.cjs');
before(async () => { await loadFrontend(context); });
const source = {id:42,name:'<Project>',note:'Planning',project_url:'https://example.com',image:'',print_id:null,has_image:0,metadata:{filename:'Test.3mf',sha256:'hash',designer:'Designer',license:'License',application:'Bambu',printer:'P2S',layer_height:'0.2',infill:'15%',configured_filaments:[{id:'2',type:'PETG',color:'#000000'}],plate:{id:'1',name:'Plade 1',objects:['<Object>'],estimated_seconds:10481,estimated_grams:103.04,filaments:[{id:'1',type:'PLA',color:'#ffffff',grams:103.04}]}}};
context.projectFixture = source;
test('upcoming project cards escape content and retain unknown estimates', () => {
  vm.runInContext('upcomingProjects = [projectFixture]; renderProjects()',context);
  const html=node('#projects-list').innerHTML;
  assert.match(html,/&lt;Project&gt;/);
  assert.match(html,/Planlagt · intet lagertræk/);
  assert.match(html,/data-start-project="42"/);
  assert.match(html,/103,04 g/);
  vm.runInContext('upcomingProjects = [{...projectFixture,print_id:3}]; renderProjects()',context);
  assert.match(node('#projects-list').innerHTML,/data-project-print="3"/);
  assert.match(node('#projects-list').innerHTML,/data-delete-project="42"/);
  assert.doesNotMatch(node('#projects-list').innerHTML,/data-start-project/);
});
test('project dialog preserves estimates separately from configured filament profiles', () => {
  vm.runInContext('showProjectDraft({...projectFixture.metadata,name:projectFixture.name,plates:[{...projectFixture.metadata.plate,thumbnail:""}],warnings:["Kontrollér estimater"]})',context);
  assert.equal(node('#project-name').value,'<Project>');
  assert.equal(node('#project-hours').value,2);
  assert.equal(node('#project-minutes').value,55);
  assert.match(node('#project-details').innerHTML,/&lt;Object&gt;/);
  assert.match(node('#project-details').innerHTML,/ikke nødvendigvis anvendt/);
  node('#project-hours').value='3';node('#project-minutes').value='5';node('#project-grams').value='110';
  vm.runInContext('rememberProjectPlate()',context);
  assert.equal(vm.runInContext('activeProjectPlate().estimated_seconds',context),11100);
  assert.equal(vm.runInContext('activeProjectPlate().estimated_grams',context),110);
});
test('starting a project prepares a new print without choosing spools or posting until save', async () => {
  vm.runInContext(`projectCalls=[]; load=async()=>{inventoryState.spools=[{id:8,name:'PLA',material:'PLA',remaining:500,weight:1000}];}; request=async(url,options)=>{if(url==='/api/files')return [{id:7,name:'Source',filename:'model.3mf'}];if(url==='/api/files/7/preview')return {plates:[]};projectCalls.push({url,options});return {ok:true};}; loadUsage=async()=>{}; loadProjects=async()=>{}; notify=()=>{};`,context);
  await vm.runInContext('startPlannedProject({...projectFixture,archive_file_id:7})',context);
  assert.equal(vm.runInContext('printDraft.projectId',context),42);
  assert.equal(vm.runInContext('printDraft.printId',context),null);
  assert.equal(vm.runInContext('printDraft.items.length',context),1);
  assert.equal(vm.runInContext('printDraft.items[0].filament_id',context),-1);
  assert.equal(vm.runInContext('printDraft.items[0].grams',context),103.04);
  assert.equal(vm.runInContext('projectCalls.length',context),0);
  assert.equal(node('#print-status').value,'pending');
  assert.equal(node('#print-hours').value,2);
  assert.equal(node('#print-minutes').value,55);
  assert.match(node('#planned-print-hints').innerHTML,/103,04/);
  await node('#print-form').onsubmit({preventDefault(){}});
  assert.equal(vm.runInContext('projectCalls.length',context),0);
  node('#print-items').onchange({target:{dataset:{printSpool:'-1'},value:'8'}});
  assert.equal(vm.runInContext('printDraft.items[0].grams',context),103.04);
  await node('#print-form').onsubmit({preventDefault(){}});
  const call=JSON.parse(vm.runInContext('JSON.stringify(projectCalls[0])',context));
  assert.equal(call.url,'/api/prints');
  assert.equal(call.options.method,'POST');
  const body=JSON.parse(call.options.body);
  assert.equal(body.planned_project_id,42);
  assert.equal(body.archive_file_id,7);
  assert.equal(node('#print-archive-file').disabled,true);
  assert.equal(body.duration_minutes,175);
  assert.equal(body.items[0].filament_id,8);
});

test('project build plate selector defaults only new drafts and preserves saved choices', () => {
  vm.runInContext(`buildPlates=[{id:1,name:'Textured PEI'},{id:2,name:'Smooth <PEI>'}]; showProjectDraft({...projectFixture.metadata,name:'New',plates:[{...projectFixture.metadata.plate,thumbnail:''}]})`,context);
  assert.equal(node('#project-build-plate').value,'1');
  assert.match(node('#project-build-plate').innerHTML,/Smooth &lt;PEI&gt;/);
  vm.runInContext(`showProjectDraft({...projectFixture.metadata,build_plate_id:2,name:'Existing',plates:[{...projectFixture.metadata.plate,thumbnail:''}]},42)`,context);
  assert.equal(node('#project-build-plate').value,'2');
  vm.runInContext(`showProjectDraft({...projectFixture.metadata,build_plate_id:null,name:'Legacy',plates:[{...projectFixture.metadata.plate,thumbnail:''}]},42)`,context);
  assert.equal(node('#project-build-plate').value,'');
});

test('planned filament types remain editable and appear safely on project cards', () => {
  vm.runInContext(`showProjectDraft({...projectFixture.metadata,name:'Types',filament_types:['PLA Basic','PETG HF'],plates:[{...projectFixture.metadata.plate,thumbnail:''}]},42)`,context);
  assert.equal(node('#project-filament-types').value,'PLA Basic, PETG HF');
  vm.runInContext(`upcomingProjects=[{...projectFixture,filament_types:['<PLA>','PETG HF']}]; renderProjects()`,context);
  assert.match(node('#projects-list').innerHTML,/Filament: &lt;PLA&gt;, PETG HF/);
});

test('project amounts transfer without guessing the division across multiple filaments', () => {
  context.multiPlate = {estimated_grams:150,filaments:[{id:'1',type:'PLA',grams:100},{id:'2',type:'PETG',grams:50}]};
  const lines=JSON.parse(vm.runInContext('JSON.stringify(plannedPrintLines(multiPlate))',context));
  assert.deepEqual(lines.map(line=>line.grams),[100,50]);
  assert.deepEqual(lines.map(line=>line.filament_id),[-1,-2]);
  assert.equal(vm.runInContext('plannedPrintLines({estimated_grams:110,filaments:[{id:"1",grams:100}]})[0].grams',context),110);
  assert.equal(vm.runInContext('plannedPrintLines({estimated_grams:42,filaments:[]})[0].grams',context),42);
  assert.equal(vm.runInContext('plannedPrintLines({estimated_grams:null,filaments:[]}).length',context),0);
});

test('completed project deletion prompts and preserves a declined project', async () => {
  context.cleanupRequests=[]; context.cleanupPrompts=[];
  vm.runInContext(`request=async(url,options)=>{cleanupRequests.push({url,options});return url === '/api/projects' ? [{id:42,name:'Projekt',print_id:5,print_status:'completed'}] : {ok:true};}; loadProjects=async()=>{};`,context);
  context.confirm = message => {context.cleanupPrompts.push(message);return false;};
  await vm.runInContext('offerCompletedProjectDeletion(5,null)',context);
  assert.equal(context.cleanupPrompts.length,1);
  assert.match(context.cleanupPrompts[0],/historikken bevares/);
  assert.equal(context.cleanupRequests.some(item=>item.options?.method === 'DELETE'),false);
  context.confirm = () => true;
  await vm.runInContext('offerCompletedProjectDeletion(5,null)',context);
  assert.equal(context.cleanupRequests.some(item=>item.url === '/api/projects/42' && item.options?.method === 'DELETE'),true);
});

test('planning renders shortages, unknown estimates and manual wishes safely', () => {
  context.planningProduct = {name:'<PLA>',manufacturer:'Test',material:'PLA',color:'Sort',product_id:'P1',product_url:'https://example.com/pla',color_hex:'#000000',transparency:'opaque',diameter:1.75,weight:1000,purchase_format:'spool'};
  vm.runInContext(`planning={products:[],needs:[{product:planningProduct,required:500,available:300,missing:200,largest_spool:200,unknown:1,split_required:true,projects:[{project_id:42,name:'<Project>',grams:250}]}],unresolved:[{name:'<Unassigned>',line:2,grams:null}],wishes:[{id:1,name:'<Wish>',grams:null,note:'<Note>',product_url:'javascript:evil'}]}; renderPlanning();`,context);
  assert.match(node('#planning-needs').innerHTML,/500 g \+ ukendt/);
  assert.match(node('#planning-needs').innerHTML,/Kræver spoleskift/);
  assert.match(node('#shopping-shortages').innerHTML,/Køb mindst 200 g/);
  assert.match(node('#shopping-shortages').innerHTML,/https:\/\/example.com\/pla/);
  assert.match(node('#planning-unresolved').innerHTML,/&lt;Unassigned&gt;.*Ukendt estimat/);
  assert.match(node('#shopping-wishes').innerHTML,/&lt;Wish&gt;/);
  assert.doesNotMatch(node('#shopping-wishes').innerHTML,/javascript:|<Wish>|<Note>/);
  const summary = vm.runInContext('projectDemandSummary(projectFixture)',context);
  assert.match(summary,/250 g behov · 300 g på lager/);
  assert.match(summary,/Kræver spoleskift/);
});

test('project product choices preserve a product after its last spool is removed', () => {
  vm.runInContext(`planning.products=[]; showProjectDraft({...projectFixture.metadata,name:'Plan',plates:[{...projectFixture.metadata.plate,material_choices:[planningProduct],thumbnail:''}]})`,context);
  assert.match(node('#project-details').innerHTML,/value="0" selected/);
  assert.match(node('#project-details').innerHTML,/&lt;PLA&gt;/);
  const original = context.document.querySelectorAll;
  context.document.querySelectorAll = selector => selector === '[data-project-product]' ? [{value:'0'}] : [];
  vm.runInContext('rememberProjectPlate()',context);
  assert.equal(vm.runInContext('activeProjectPlate().material_choices[0].product_id',context),'P1');
  context.document.querySelectorAll = original;
});

test('manual shopping form saves unknown amounts and removes wishes independently', async () => {
  vm.runInContext(`shoppingCalls=[]; request=async(url,options)=>{shoppingCalls.push({url,options});return url === '/api/planning' ? {products:[],needs:[],unresolved:[],wishes:[]} : {ok:true};};`,context);
  node('#shopping-name').value='Nyt PLA'; node('#shopping-id').value=''; node('#shopping-grams').value=''; node('#shopping-url').value=''; node('#shopping-note').value='Test';
  await node('#shopping-form').onsubmit({preventDefault(){}});
  const call=JSON.parse(vm.runInContext('JSON.stringify(shoppingCalls[0])',context));
  assert.equal(call.url,'/api/shopping-wishes');
  assert.deepEqual(JSON.parse(call.options.body),{name:'Nyt PLA',grams:null,product_url:'',note:'Test'});
  await node('#shopping-wishes').onclick({target:{closest:selector=>selector === '[data-delete-wish]' ? {dataset:{deleteWish:'7'}} : null}});
  assert.equal(vm.runInContext('shoppingCalls[2].url',context),'/api/shopping-wishes/7');
  assert.equal(vm.runInContext('shoppingCalls[2].options.method',context),'DELETE');
});

test('project quantity scales totals and print lines while keeping unit estimates editable', () => {
  vm.runInContext(`showProjectDraft({...projectFixture.metadata,name:'Flere',plates:[{...projectFixture.metadata.plate,quantity:3,estimated_grams:100,estimated_seconds:3600,thumbnail:''}]})`,context);
  assert.equal(node('#project-quantity').value,3);
  assert.equal(node('#project-grams').value,100);
  assert.match(node('#project-quantity-total').textContent,/3 × 100 g = 300 g i alt/);
  node('#project-quantity').value='4';
  vm.runInContext('rememberProjectPlate()',context);
  assert.equal(vm.runInContext('activeProjectPlate().estimated_grams',context),100);
  assert.equal(vm.runInContext('plannedPrintLines(activeProjectPlate())[0].grams',context),400);
  vm.runInContext('rememberProjectPlate()',context);
  assert.equal(vm.runInContext('plannedPrintLines(activeProjectPlate())[0].grams',context),400);
  context.quantityPlate = {quantity:3,estimated_grams:150,filaments:[{id:'1',grams:100},{id:'2',grams:null}]};
  const lines = JSON.parse(vm.runInContext('JSON.stringify(plannedPrintLines(quantityPlate))',context));
  assert.deepEqual(lines.map(line=>line.grams),[300,'']);
  assert.equal(vm.runInContext('plannedPrintLines({quantity:4,estimated_grams:25,filaments:[]})[0].grams',context),100);
  vm.runInContext('upcomingProjects=[{...projectFixture,metadata:{...projectFixture.metadata,plate:{...projectFixture.metadata.plate,quantity:3,estimated_grams:100}}}]; renderProjects()',context);
  assert.match(node('#projects-list').innerHTML,/3 stk\./);
  assert.match(node('#projects-list').innerHTML,/300 g/);
});

test('opening the build plates route directly loads its saved plate types', async()=>{
  const freshNodes=new Map();
  const query=selector=>{
    if(!freshNodes.has(selector)) freshNodes.set(selector,{value:'',dataset:{},addEventListener(){},classList:{toggle(){}},setAttribute(){},removeAttribute(){}});
    return freshNodes.get(selector);
  };
  const fresh=vm.createContext({Intl,URL,window:{location:{hash:''},addEventListener(){}},document:{querySelector:query,querySelectorAll:()=>[]}});
  await loadFrontend(fresh);
  const calls=[];
  fresh.request=async url=>{calls.push(url);return [{id:5,name:'Smooth PEI'}];};
  fresh.window.location.hash='#build-plates';

  await vm.runInContext('switchView()',fresh);
  assert.deepEqual(calls,['/api/build-plates']);
  assert.match(query('#build-plate-list').innerHTML,/Smooth PEI/);
});
