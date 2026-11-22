const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {loadFrontend}=require('./frontend-loader.cjs');

const spool={id:12,name:'Bambu PAHT CF Black',manufacturer:'Bambu Lab',material:'PAHT CF',color:'Black',product_id:'70100',color_hex:'#000000',label_token:'permanent-12'};
const link='https://filament.example.com/#spool/permanent-12';
async function renderer() {
  const {thermalLabel}=await import('../static/thermal-labels.js');
  const {configureI18n}=await import('../static/i18n.js');
  const catalog=JSON.parse(fs.readFileSync('static/locales/en.json','utf8'));
  configureI18n(catalog);
  return thermalLabel;
}

test('both thermal layouts preserve encoded modules and quiet zones around the styled finder',async()=>{
  const thermalLabel=await renderer();
  const {default:qrcodegen}=await import('../static/vendor/qrcodegen.js');
  const qr=qrcodegen.QrCode.encodeText(link,qrcodegen.QrCode.Ecc.MEDIUM);
  for(const size of ['40x30','60x40','70x80'])for(const layout of ['compact','extended']) {
    const result=thermalLabel(spool,link,{size,layout,nozzle:'260–290°C',bed:'80–100°C',flow:'0.96',drying:'80°C/12h'});
    const [w,h]=size.split('x').map(Number);
    assert.equal(result.width,Math.round(w/25.4*203));
    assert.equal(result.height,Math.round(h/25.4*203));
    assert.ok(result.moduleDots>=2);
    assert.match(result.svg,/PAHT CF/);
    assert.match(result.svg,/Black \(70100\)/);
    assert.match(result.svg,/#000000/);
    assert.match(result.svg,/Lwde, CC BY-SA 4.0/);
    assert.doesNotMatch(result.svg,/<image|<script|foreignObject|fill="(?!black|white)[^"]+"|https?:\/\/[^<]*\.js/);
    const path=[...result.svg.matchAll(/<path fill="black" shape-rendering="crispEdges" d="([^"]+)"/g)][0][1];
    const dots=[...path.matchAll(/M(\d+),(\d+)h(\d+)v(\d+)h-(\d+)z/g)].map(m=>m.slice(1).map(Number));
    const minX=Math.min(...dots.map(d=>d[0])),minY=Math.min(...dots.map(d=>d[1]));
    assert.ok(minX>=16+4*result.moduleDots);
    assert.ok(minY>=16+4*result.moduleDots);
    const actual=new Set(dots.map(([x,y,a,b,c])=>{
      assert.equal(a,result.moduleDots);assert.equal(b,a);assert.equal(c,a);
      assert.ok(x+a+4*a<=result.width-16);
      assert.ok(y+a+4*a<=result.height-16);
      return `${(x-minX)/a},${(y-minY)/a}`;
    }));
    for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)assert.equal(actual.has(`${x},${y}`),x<7 && y<7?false:qr.getModule(x,y),`${size}/${layout}: ${x},${y}`);
    const circles=[...result.svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="(black|white)"/g)];
    assert.equal(circles.length,3);
    for(const [index,circle] of circles.entries()) {
      assert.equal(Number(circle[1]),minX+3.5*result.moduleDots);
      assert.equal(Number(circle[2]),minY+3.5*result.moduleDots);
      assert.equal(Number(circle[3]),(3.5-index)*result.moduleDots);
      assert.equal(circle[4],index===1?'white':'black');
    }
    if(layout==='extended') {
      const contentWidth=result.width-32, font=Math.min(32,Math.max(19,contentWidth*.065));
      const oldLowerHeight=result.height-16-(16+Math.round(contentWidth/8.48)+8+font*2+16);
      const oldModuleDots=Math.floor(Math.min(contentWidth*.43,oldLowerHeight)/(qr.size+8));
      assert.ok(result.qrWidth>(qr.size+8)*oldModuleDots,'extended QR is larger than the previous layout');
      for(const text of ['260–290°C','80–100°C','0.96','80°C/12h'])assert.ok(result.svg.includes(text));
    } else assert.doesNotMatch(result.svg,/260–290°C|80°C\/12h/);
  }
});

test('thermal label escapes all user text and uses manufacturer text for other brands',async()=>{
  const thermalLabel=await renderer();
  const result=thermalLabel({...spool,manufacturer:'<Other>',material:'<script>alert(1)</script>',color:'<img onerror="x">',color_hex:'red',product_id:'<&>'},link);
  assert.match(result.svg,/&lt;Other&gt;/);
  assert.doesNotMatch(result.svg,/Lwde|<script|<img|onerror="x"/);
  assert.match(result.svg,/&lt;&amp;&gt;/);
  assert.match(result.svg,/Nozzle: —/);
  assert.match(result.svg,/Flow ratio: —/);
  assert.throws(()=>thermalLabel(spool,link,{size:'1000x1000'}),/valid/);
  assert.throws(()=>thermalLabel(spool,'https://example.com/'+ 'a'.repeat(1200),{size:'40x30'}),/too long/);
});

test('single-spool dialog resets label overrides and retains the permanent QR destination',async()=>{
  const nodes=new Map();
  const context=vm.createContext({URL,Intl,window:{location:{href:link},addEventListener(){}},document:{querySelector(selector){
    if(!nodes.has(selector))nodes.set(selector,{value:'',classList:{toggle(){}},showModal(){this.open=true;}});
    return nodes.get(selector);
  }}});
  const graph=await loadFrontend(context,[],{entry:'labels.js',init:false});
  context.inventoryState.spools=[{...spool,nozzle_temp:270,bed_temp:90},{...spool,id:13,label_token:'permanent-13',nozzle_temp:0,bed_temp:0}];
  graph.namespace.openLabel(12);
  assert.equal(nodes.get('#thermal-nozzle').value,'270°C');
  assert.equal(nodes.get('#thermal-bed').value,'90°C');
  assert.equal(nodes.get('#thermal-download').disabled,false);
  assert.match(nodes.get('#thermal-preview').innerHTML,/PAHT CF/);
  nodes.get('#thermal-flow').value='0.96';
  nodes.get('#thermal-drying').value='80°C/12h';
  graph.namespace.openLabel(13);
  for(const id of ['nozzle','bed','flow','drying'])assert.equal(nodes.get('#thermal-'+id).value,'');
  assert.equal(nodes.get('#label-link').value,'https://filament.example.com/#spool/permanent-13');
});

test('PNG export uses printer-dot dimensions, thresholds every pixel, and releases its SVG URL',async()=>{
  const {labelPng}=await import('../static/thermal-labels.js');
  const originalDocument=global.document,originalImage=global.Image;
  const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
  const revoked=[], draws=[];
  const data=new Uint8ClampedArray([100,100,100,100,220,220,220,255]);
  const canvas={getContext:()=>({drawImage:(...args)=>draws.push(args),getImageData:()=>({data}),putImageData(){}}),toBlob:callback=>callback(new Blob(['png'],{type:'image/png'}))};
  global.document={createElement:()=>canvas};
  global.Image=class {set src(value){this.onload();}};
  URL.createObjectURL=()=> 'blob:label';URL.revokeObjectURL=url=>revoked.push(url);
  try {
    const blob=await labelPng({svg:'<svg/>',width:320,height:240});
    assert.equal(blob.type,'image/png');
    assert.equal(canvas.width,320);assert.equal(canvas.height,240);
    assert.deepEqual(draws[0].slice(1),[0,0,320,240]);
    assert.deepEqual([...data],[0,0,0,255,255,255,255,255]);
    assert.deepEqual(revoked,['blob:label']);
    global.Image=class {set src(value){this.onerror(new Error('decode failure'));}};
    await assert.rejects(labelPng({svg:'<svg/>',width:320,height:240}),/decode failure/);
    assert.equal(revoked.length,2);
  } finally {
    global.document=originalDocument;global.Image=originalImage;
    URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;
  }
});

function profileFixture() {
  const data=JSON.parse(fs.readFileSync('src/reference/bambu_filament_guide.json','utf8'));
  const profile=data.profiles.find(item=>item.material==='PAHT-CF');
  return {...profile,source_url:data.source_url};
}
async function profileDialog(fetch) {
  const nodes=new Map();
  const context=vm.createContext({URL,URLSearchParams,Intl,fetch,
    window:{location:{href:link},addEventListener(){}},document:{querySelector(selector){
      if(!nodes.has(selector))nodes.set(selector,{value:'',classList:{toggle(){}},showModal(){},setAttribute(){}});
      return nodes.get(selector);
    }},
  });
  const graph=await loadFrontend(context,[],{entry:'labels.js',init:false});
  context.inventoryState.spools=[{...spool,nozzle_temp:270,bed_temp:90},{...spool,id:13,material:'Unknown',label_token:'permanent-13'}];
  graph.namespace.initLabels();
  return {nodes,context,labels:graph.namespace};
}

test('guide fills only empty fields, preserves saved temperatures, and offers explicit plate/method choices',async()=>{
  const profile=profileFixture();
  const {nodes,labels}=await profileDialog(async url=>{
    assert.match(url,/manufacturer=Bambu\+Lab&material=PAHT\+CF/);
    return {ok:true,json:async()=>profile};
  });
  await labels.openLabel(12);
  assert.equal(nodes.get('#thermal-nozzle').value,'270°C');
  assert.equal(nodes.get('#thermal-bed').value,'90°C');
  assert.equal(nodes.get('#thermal-drying').value,'80°C/8–12h');
  assert.equal(nodes.get('#thermal-flow').value,'');
  assert.match(nodes.get('#thermal-flow-note').textContent,/ikke flow ratio/);
  assert.match(nodes.get('#thermal-plate').innerHTML,/Textured PEI Plate/);
  assert.equal(nodes.get('#thermal-guide-controls').hidden,false);
  nodes.get('#thermal-use-guide').onclick();
  assert.equal(nodes.get('#thermal-nozzle').value,'260–300°C');
  assert.equal(nodes.get('#thermal-bed').value,'100–120°C');
  nodes.get('#thermal-drying-method').value='1';
  nodes.get('#thermal-drying-method').onchange();
  assert.equal(nodes.get('#thermal-drying').value,'90–100°C/12h');
  assert.match(nodes.get('#thermal-drying-note').textContent,/vend det halvvejs/);
});

test('slow profile responses preserve in-progress edits and cannot overwrite a newly opened spool',async()=>{
  const pending=[];
  const {nodes,labels}=await profileDialog(()=>new Promise(resolve=>pending.push(resolve)));
  const first=labels.openLabel(12);
  nodes.get('#thermal-drying').value='75°C/10h';
  nodes.get('#thermal-drying').oninput();
  pending.shift()({ok:true,json:async()=>profileFixture()});
  await first;
  assert.equal(nodes.get('#thermal-drying').value,'75°C/10h');
  const second=labels.openLabel(12);
  const third=labels.openLabel(13);
  const [resolveSecond,resolveThird]=pending;
  resolveThird({ok:true,json:async()=>null});await third;
  resolveSecond({ok:true,json:async()=>profileFixture()});await second;
  assert.equal(nodes.get('#thermal-drying').value,'');
  assert.equal(nodes.get('#thermal-guide-controls').hidden,true);
  assert.match(nodes.get('#thermal-guide-status').textContent,/Ingen præcis profil/);
});

test('failed profile lookup leaves manual label generation usable',async()=>{
  const {nodes,labels}=await profileDialog(async()=>{throw new Error('offline');});
  await labels.openLabel(12);
  assert.match(nodes.get('#thermal-guide-status').textContent,/kunne ikke hentes/);
  assert.equal(nodes.get('#thermal-download').disabled,false);
  assert.equal(nodes.get('#thermal-nozzle').value,'270°C');
});
