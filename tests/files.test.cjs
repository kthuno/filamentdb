const {test, before} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const nodes = new Map();
function node(selector) {
  if (!nodes.has(selector)) nodes.set(selector,{value:'',dataset:{},hidden:false,addEventListener(){},classList:{toggle(){}},setAttribute(){},removeAttribute(){},reset(){},showModal(){this.open=true;},close(){this.open=false;}});
  return nodes.get(selector);
}
const context = vm.createContext({Intl,URL,window:{location:{hash:''},addEventListener(){}},document:{querySelector:node,querySelectorAll:()=>[]},confirm:()=>true});
const {loadFrontend} = require('./frontend-loader.cjs');
before(async () => { await loadFrontend(context); });
context.fixture = {
  id:7,name:'<Model>',note:'Brim\n<my notes>',filename:'Test æ.3mf',sha256:'a'.repeat(64),size_bytes:1024,created_at:'2026-11-17',updated_at:'2026-11-17',project_count:1,
  projects:[{id:42,name:'<Project>',print_id:null}],
  metadata:{name:'Source title',filename:'Test æ.3mf',sha256:'a'.repeat(64),designer:'<Designer>',license:'CC',application:'Bambu',printer:'P2S',layer_height:'0.2',infill:'15%',configured_filaments:[],warnings:['Kontrollér estimater'],plates:[{id:'1',name:'<Plate>',objects:['<Object>'],filaments:[{id:'1',type:'PLA',color:'#fff',grams:100}],estimated_grams:100,estimated_seconds:3600},{id:'2',name:'Unknown plate',objects:[],filaments:[],estimated_grams:null,estimated_seconds:null}]}
};

test('archive lists and searches filenames, titles and notes without interpreting HTML', () => {
  vm.runInContext('archivedFiles = [fixture]; renderFileArchive()',context);
  let html = node('#files-list').innerHTML;
  assert.match(html,/&lt;Model&gt;/);
  assert.doesNotMatch(html,/my notes|file-card-note/);
  assert.match(html,/href="\/api\/files\/7\/download" download/);
  assert.match(html,/data-file-project="7"/);
  assert.match(html,/data-delete-file="7"/);
  assert.match(html,/<article class="file-card" tabindex="0" data-edit-file="7"/);
  assert.doesNotMatch(html,/Se \/ redigér/);
  assert.match(html,/file-card-download/);
  node('#file-search').value = 'BRIM';
  vm.runInContext('renderFileArchive()',context);
  assert.match(node('#files-status').textContent,/1 af 1/);
  node('#file-search').value = 'no match';
  vm.runInContext('renderFileArchive()',context);
  assert.match(node('#files-status').textContent,/0 af 1/);
  assert.match(node('#files-list').innerHTML,/Ingen filer matcher/);
  node('#file-search').value = '';
});

test('file details show all plates, unknown estimates, notes and project references', async () => {
  context.request = async url => { assert.equal(url,'/api/files/7'); return context.fixture; };
  await vm.runInContext('openArchiveFile(7)',context);
  const html = node('#file-metadata').innerHTML;
  assert.match(html,/&lt;Designer&gt;/);
  assert.match(html,/&lt;Object&gt;/);
  assert.match(html,/Printplader \(2\)/);
  assert.match(html,/Ukendt forbrug/);
  assert.match(html,/Ikke angivet/);
  assert.equal(node('#file-note').value,'Brim\n<my notes>');
  assert.equal(node('#file-download').href,'/api/files/7/download');
  assert.match(node('#file-projects').innerHTML,/data-linked-project="42"/);
  assert.match(node('#file-projects').innerHTML,/&lt;Project&gt;/);
  assert.equal(node('#file-dialog').open,true);
});

test('editing file notes sends only editable fields and keeps metadata independent', async () => {
  const writes = [];
  context.request = async (url,options) => {
    if (options) { writes.push({url,options}); return {ok:true}; }
    if (url === '/api/files') return [context.fixture];
    throw new Error(url);
  };
  vm.runInContext('notify = () => {}; editingArchiveFile = fixture',context);
  node('#file-dialog').open = true;
  node('#file-name').value = 'Edited title'; node('#file-note').value = 'Own notes';
  await node('#file-form').onsubmit({preventDefault(){}});
  assert.equal(writes.length,1);
  assert.equal(writes[0].url,'/api/files/7');
  assert.equal(writes[0].options.method,'PUT');
  assert.deepEqual(JSON.parse(writes[0].options.body),{name:'Edited title',note:'Own notes',plate_estimates:{}});
  assert.equal(node('#file-dialog').open,false);
  assert.equal(context.fixture.metadata.name,'Source title');
  assert.equal(node('#file-error').textContent,'');
});

test('creating a project keeps the archive reference outside project metadata', async () => {
  const draft = {...context.fixture.metadata,name:'Archived title',archive_file_id:7};
  context.request = async url => {
    if (url === '/api/files/7/preview') return draft;
    throw new Error(url);
  };
  vm.runInContext('loadBuildPlates = async () => {}; loadPlanning = async () => {}; loadProjects = async () => {}; buildPlates = []',context);
  await vm.runInContext('createProjectFromArchive(7)',context);
  assert.equal(node('#file-dialog').open,false);
  assert.equal(node('#project-dialog').open,true);
  assert.equal(node('#project-name').value,'Archived title');
  assert.equal(node('#project-note').value,'');
  assert.equal(node('#project-archive-link').href,'#files/7');
  assert.equal(node('#project-archive-link').hidden,false);
  let body;
  context.request = async (url,options) => { assert.equal(url,'/api/projects'); body = JSON.parse(options.body); return {ok:true}; };
  await node('#project-form').onsubmit({preventDefault(){}});
  assert.equal(body.archive_file_id,7);
  assert.equal(body.metadata.sha256,'a'.repeat(64));
  assert.equal(body.metadata.plate.id,'1');
  assert.equal(Object.hasOwn(body.metadata,'archive_file_id'),false);
  assert.equal(Object.hasOwn(body.metadata,'plates'),false);
  assert.equal(Object.hasOwn(body.metadata.plate,'thumbnail'),false);
});

test('declining file deletion leaves the file and projects untouched', async () => {
  context.confirm = () => false;
  context.request = async () => { throw new Error('Unexpected mutation'); };
  assert.equal(await vm.runInContext('removeArchiveFile(7)',context),false);
  context.confirm = () => true;
});

test('invalid uploads report an error and release the upload control', async () => {
  context.request = async () => { throw new Error('Unexpected upload'); };
  const target = {files:[{name:'bad.zip',size:100}],value:'bad.zip',disabled:false};
  await node('#archive-file-upload').onchange({target});
  assert.match(node('#files-upload-errors').textContent,/bad.zip: Vælg en 3MF/);
  assert.equal(target.disabled,false);
  assert.equal(target.value,'');
  assert.equal(vm.runInContext('archiveBusy',context),false);
});

test('archive estimates retain separate plate values and reject invalid minutes without closing', async () => {
  context.fixture.plate_estimates = {};
  context.request = async url => { assert.equal(url,'/api/files/7'); return context.fixture; };
  await vm.runInContext('openArchiveFile(7)',context);
  assert.equal(node('#file-estimate-hours').value,'');
  assert.equal(node('#file-estimate-hours').placeholder,'1');
  node('#file-estimate-hours').value = '2'; node('#file-estimate-minutes').value = '30'; node('#file-estimate-grams').value = '245.5';
  node('#file-estimate-plate').onchange({target:{value:'1'}});
  assert.equal(node('#file-estimate-hours').value,'');
  assert.match(node('#file-estimate-source').textContent,/Forbrug ikke angivet/);
  node('#file-estimate-minutes').value = '45'; node('#file-estimate-grams').value = '125';
  node('#file-estimate-plate').onchange({target:{value:'0'}});
  assert.equal(Number(node('#file-estimate-hours').value),2);
  assert.equal(Number(node('#file-estimate-minutes').value),30);
  assert.equal(Number(node('#file-estimate-grams').value),245.5);
  const estimates = JSON.parse(vm.runInContext('JSON.stringify(archiveEstimateDraft)',context));
  assert.deepEqual(estimates,{'1':{estimated_seconds:9000,estimated_grams:245.5},'2':{estimated_seconds:2700,estimated_grams:125}});
  let called = false;
  context.request = async () => { called = true; throw new Error('Unexpected request'); };
  node('#file-estimate-minutes').value = '60';
  await node('#file-form').onsubmit({preventDefault(){}});
  assert.equal(called,false);
  assert.equal(node('#file-dialog').open,true);
  assert.match(node('#file-error').textContent,/minutter fra 0 til 59/);
  node('#file-estimate-minutes').value = '30';
});

test('creating a project from the dialog saves edited estimates before loading its preview', async () => {
  const calls = [];
  context.request = async (url,options) => {
    calls.push({url,options});
    if (options) return {ok:true};
    if (url === '/api/files/7/preview') return {...context.fixture.metadata,archive_file_id:7,plates:context.fixture.metadata.plates.map(plate => ({...plate,estimated_seconds:9000,estimated_grams:245.5}))};
    throw new Error(url);
  };
  await node('#file-create-project').onclick();
  assert.equal(calls[0].url,'/api/files/7');
  assert.equal(calls[0].options.method,'PUT');
  assert.deepEqual(JSON.parse(calls[0].options.body).plate_estimates,{'1':{estimated_seconds:9000,estimated_grams:245.5},'2':{estimated_seconds:2700,estimated_grams:125}});
  assert.equal(calls[1].url,'/api/files/7/preview');
  assert.equal(Number(node('#project-hours').value),2);
  assert.equal(Number(node('#project-minutes').value),30);
  assert.equal(Number(node('#project-grams').value),245.5);
  assert.equal(node('#file-dialog').open,false);
  assert.equal(node('#project-dialog').open,true);
});

test('archive card clicks and keyboard activation edit without hijacking actions', async () => {
  const originalOpen = context.openArchiveFile;
  const originalCreate = context.createProjectFromArchive;
  const originalDelete = context.removeArchiveFile;
  const calls = [];
  context.openArchiveFile = async id => calls.push(['edit',id]);
  context.createProjectFromArchive = async id => calls.push(['project',id]);
  context.removeArchiveFile = async id => calls.push(['delete',id]);
  const card = {dataset:{editFile:'7'}};
  const click = (button=null,link=null) => node('#files-list').onclick({target:{closest:selector => selector === 'a' ? link : selector === 'button' ? button : card}});
  try {
    await click();
    await click(null,{});
    await click({dataset:{fileProject:'7'}});
    await click({dataset:{deleteFile:'7'}});
    assert.deepEqual(calls,[['edit',7],['project',7],['delete',7]]);
    let activated = 0, prevented = 0;
    for (const key of ['Enter',' ']) node('#files-list').onkeydown({key,target:{matches:()=>true,click(){activated++;}},preventDefault(){prevented++;}});
    node('#files-list').onkeydown({key:'Enter',target:{matches:()=>false,click(){throw new Error('Nested action hijacked');}},preventDefault(){throw new Error('Nested key prevented');}});
    assert.equal(activated,2);
    assert.equal(prevented,2);
  } finally {
    context.openArchiveFile = originalOpen;
    context.createProjectFromArchive = originalCreate;
    context.removeArchiveFile = originalDelete;
  }
});

test('batch upload continues after failures, refreshes once and opens no dialogs', async () => {
  const files = [{name:'Første.3mf',size:100},{name:'bad.zip',size:100},{name:'Broken.3mf',size:100},{name:'Last.3mf',size:100}];
  const calls = [];
  let active = 0, maxActive = 0;
  context.request = async (url,options) => {
    calls.push({url,options});
    if (!options) { assert.equal(url,'/api/files'); return [context.fixture]; }
    active++; maxActive = Math.max(maxActive,active);
    await Promise.resolve(); active--;
    if (options.body.name === 'Broken.3mf') throw new Error('Could not parse');
    assert.equal(options.method,'POST');
    assert.equal(decodeURIComponent(options.headers['X-Filename']),options.body.name);
    return {archive_file_id:7};
  };
  const originalOpen = context.openArchiveFile;
  context.openArchiveFile = async () => { throw new Error('Upload must not open dialogs'); };
  context.window.location.hash = '#files/7';
  node('#file-dialog').open = false; node('#project-dialog').open = false;
  const target = {files,value:'selected',disabled:false};
  try {
    await node('#archive-file-upload').onchange({target});
    assert.equal(calls.filter(call => call.options).length,3);
    assert.equal(calls.filter(call => !call.options).length,1);
    assert.equal(maxActive,1);
    assert.match(node('#files-upload-status').textContent,/Indlæst 2 af 4 filer/);
    assert.match(node('#files-upload-errors').textContent,/bad.zip/);
    assert.match(node('#files-upload-errors').textContent,/Broken.3mf: Could not parse/);
    assert.equal(node('#file-dialog').open,false);
    assert.equal(node('#project-dialog').open,false);
    assert.equal(target.disabled,false);
    assert.equal(target.value,'');
    assert.equal(vm.runInContext('archiveBusy',context),false);
  } finally { context.openArchiveFile = originalOpen; context.window.location.hash = ''; }
});

test('single-file archive upload also remains in the list without opening a dialog', async () => {
  context.request = async (url,options) => options ? {archive_file_id:7} : [context.fixture];
  node('#file-dialog').open = false;
  await node('#archive-file-upload').onchange({target:{files:[{name:'One.3mf',size:100}],disabled:false,value:'selected'}});
  assert.match(node('#files-upload-status').textContent,/Indlæst 1 af 1 filer/);
  assert.equal(node('#files-upload-errors').textContent,'');
  assert.equal(node('#file-dialog').open,false);
});

test('archive cards show print usage and details open the exact linked print safely', async () => {
  const oldRequest=context.request,oldOpen=context.openPrintEditor;
  const oldHash=context.window.location.hash;
  context.usageFixture={...context.fixture,print_count:2,last_print_date:'2026-11-21',
    prints:[{id:83,name:'<Vase>',print_date:'2026-11-21',status:'failed'}]};
  try {
    vm.runInContext('archivedFiles=[usageFixture];renderFileArchive()',context);
    assert.match(node('#files-list').innerHTML,/2 printregistreringer/);
    assert.match(node('#files-list').innerHTML,/Senest 2026-11-21/);
    context.request=async()=>context.usageFixture;
    await vm.runInContext('openArchiveFile(7)',context);
    assert.match(node('#file-prints').innerHTML,/&lt;Vase&gt;/);
    assert.match(node('#file-prints').innerHTML,/Fejlet/);
    const opened=[];
    context.openPrintEditor=async id=>opened.push(id);
    await node('#file-prints').onclick({target:{closest:()=>({dataset:{linkedPrint:'83'}})}});
    assert.deepEqual(opened,[83]);
    assert.equal(context.window.location.hash,'#usage');
    assert.equal(node('#file-dialog').open,false);
    vm.runInContext('archivedFiles=[{...usageFixture,print_count:0,last_print_date:null}];renderFileArchive()',context);
    assert.match(node('#files-list').innerHTML,/Ingen printregistreringer/);
  } finally {
    context.request=oldRequest;context.openPrintEditor=oldOpen;context.window.location.hash=oldHash;
  }
});

test('archive thumbnails use local images and follow the selected print plate with an honest fallback', async () => {
  const originalRequest=context.request;
  try {
    vm.runInContext('archivedFiles=[fixture];renderFileArchive()',context);
    assert.match(node('#files-list').innerHTML,/class="file-card-thumbnail" src="\/api\/files\/7\/image" alt="" loading="lazy"/);
    context.request=async()=>context.fixture;
    await vm.runInContext('openArchiveFile(7)',context);
    assert.equal(node('#file-preview-image').src,'/api/files/7/image?plate=1');
    assert.equal(node('#file-preview-image').hidden,false);
    assert.equal(node('#file-preview-image').alt,'Forhåndsvisning af <Plate>');
    vm.runInContext('archiveEstimatePlateIndex=1;renderArchiveEstimate()',context);
    assert.equal(node('#file-preview-image').src,'/api/files/7/image?plate=2');
    node('#file-preview-image').onerror();
    assert.equal(node('#file-preview-image').hidden,true);
    assert.equal(node('#file-preview-empty').hidden,false);
    vm.runInContext('archiveEstimatePlateIndex=0;renderArchiveEstimate()',context);
    assert.equal(node('#file-preview-image').hidden,false);
    assert.equal(node('#file-preview-empty').hidden,true);
  } finally { context.request=originalRequest; }
});
