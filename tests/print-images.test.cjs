const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {loadFrontend} = require('./frontend-loader.cjs');

async function fixture() {
  const nodes=new Map();
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{value:'',dataset:{},hidden:false,innerHTML:'',textContent:'',addEventListener(){},classList:{toggle(){}},setAttribute(){},removeAttribute(){},focus(){},reset(){},showModal(){},close(){}});
    return nodes.get(selector);
  };
  const context=vm.createContext({Intl,URL,window:{location:{hash:''},addEventListener(){}},document:{querySelector:node},request:async()=>({plates:[]})});
  await loadFrontend(context);
  return {context,node};
}

test('a linked print displays all safe source images and keeps its saved photo private',async()=>{
  const {context,node}=await fixture();
  vm.runInContext("printDraft.image='old-photo';printDraft.wasteMode=false",context);
  node('#print-archive-file').value='7';
  context.request=async url=>{
    assert.equal(url,'/api/files/7/preview');
    return {plates:[
      {name:'<Plade 1>',thumbnail:'data:image/png;base64,YQ=='},
      {name:'Plade 2',thumbnail:'data:image/jpeg;base64,Yg=='},
      {name:'Ingen thumbnail',thumbnail:''},
      {name:'External',thumbnail:'https://example.com/image.png'},
    ]};
  };
  await node('#print-archive-file').onchange();
  assert.equal(node('#print-image-field').hidden,true);
  assert.equal(node('#print-image').disabled,true);
  assert.equal(node('#print-archive-images').hidden,false);
  const gallery=node('#print-archive-gallery').innerHTML;
  assert.equal((gallery.match(/<img /g)||[]).length,2);
  assert.match(gallery,/&lt;Plade 1&gt;/);
  assert.doesNotMatch(gallery,/old-photo|example.com/);
  assert.equal(vm.runInContext('printDraft.image',context),'old-photo');
  node('#print-archive-file').value='';
  await node('#print-archive-file').onchange();
  assert.equal(node('#print-image-field').hidden,false);
  assert.equal(node('#print-image').disabled,false);
  assert.equal(node('#print-archive-images').hidden,true);
  assert.equal(node('#print-archive-gallery').innerHTML,'');
});

test('missing source pictures and failed requests never reveal a previous photo',async()=>{
  const {context,node}=await fixture();
  node('#print-archive-file').value='7';
  await node('#print-archive-file').onchange();
  assert.match(node('#print-archive-images-status').textContent,/ingen billeder/);
  assert.equal(node('#print-image-field').hidden,true);
  context.request=async()=>{throw new Error('offline');};
  await node('#print-archive-file').onchange();
  assert.match(node('#print-archive-images-status').textContent,/kunne ikke hentes/);
  assert.equal(node('#print-image-field').hidden,true);
  assert.equal(node('#print-archive-gallery').innerHTML,'');
});

test('a slow previous file response cannot overwrite the selected file gallery',async()=>{
  const {context,node}=await fixture();
  let resolveFirst;
  context.request=async url=>url.includes('/7/')?new Promise(resolve=>{resolveFirst=resolve;}):{plates:[{name:'New',thumbnail:'data:image/png;base64,Yg=='}]};
  node('#print-archive-file').value='7';
  const first=node('#print-archive-file').onchange();
  node('#print-archive-file').value='8';
  await node('#print-archive-file').onchange();
  resolveFirst({plates:[{name:'Old',thumbnail:'data:image/png;base64,YQ=='}]});
  await first;
  assert.match(node('#print-archive-gallery').innerHTML,/New/);
  assert.doesNotMatch(node('#print-archive-gallery').innerHTML,/Old/);
});
