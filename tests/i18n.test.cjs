const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {loadFrontend}=require('./frontend-loader.cjs');
const danish=JSON.parse(fs.readFileSync('static/locales/da.json','utf8'));
const registry={default:'da',languages:[{code:'da',name:'Dansk',locale:'da-DK'},{code:'en',name:'English',locale:'en-GB'}]};
const keyFor=value=>Object.keys(danish.messages).find(key=>danish.messages[key]===value && key.startsWith('ui.'));
async function moduleFixture(globals={}) {
  const context=vm.createContext({Intl,URL,...globals});
  const graph=await loadFrontend(context,[],{entry:'i18n.js',init:false,exposeInternals:false});
  return {...graph,context};
}
test('Danish fallback, named parameters and plural variants work from JSON catalogs',async()=>{
  const {namespace:i18n}=await moduleFixture();
  const english={language:'en',locale:'en-GB',messages:{
    'example.hello':'Hello {name}',
    'example.files':{countParam:'p1',one:'{p1} file',other:'{p1} files'},
    [keyFor('spole')]:'spool',[keyFor('spoler')]:'spools',
  }};
  i18n.configureI18n(english,danish,registry);
  assert.equal(i18n.t('example.hello',{name:'Kasper'}),'Hello Kasper');
  assert.equal(i18n.t('example.files',{p1:1}),'1 file');
  assert.equal(i18n.t('example.files',{p1:2}),'2 files');
  assert.equal(i18n.t(keyFor('Vælg indhold')),'Vælg indhold');
  assert.equal(i18n.tn(keyFor('spole'),keyFor('spoler'),1),'spool');
  assert.equal(i18n.tn(keyFor('spole'),keyFor('spoler'),2),'spools');
  assert.equal(i18n.getLocale(),'en-GB');
  assert.equal(i18n.t('missing.key'),'missing.key');
  assert.throws(()=>i18n.configureI18n({language:'../en',locale:'en',messages:{}}),/Invalid/);
});
test('HTML translation escapes catalog markup and preserves already-escaped interpolations',async()=>{
  const {namespace:i18n}=await moduleFixture();
  i18n.configureI18n({language:'en',locale:'en-GB',messages:{label:'<img src=x onerror=alert(1)> {name}'}},danish,registry);
  assert.equal(i18n.th('label',{name:'&lt;User&gt;'}),'&lt;img src=x onerror=alert(1)&gt; &lt;User&gt;');
});
test('static text and accessible attributes change without touching form values or child elements',async()=>{
  const text={nodeType:3,nodeValue:'Lager'}, dot={nodeType:1};
  const heading={childNodes:[text,dot],getAttribute:()=>'0:'+keyFor('Lager')};
  const input={value:'User data',attrs:{},getAttribute:()=>keyFor('Søg filament'),setAttribute(name,value){this.attrs[name]=value;}};
  const document={documentElement:{lang:'da'},querySelectorAll(selector){
    if(selector==='[data-i18n-text]')return [heading];
    if(selector==='[data-i18n-aria-label]')return [input];
    return [];
  }};
  const {namespace:i18n}=await moduleFixture();
  i18n.configureI18n({language:'en',locale:'en-GB',messages:{[keyFor('Lager')]:'Inventory',[keyFor('Søg filament')]:'Search filament'}},danish,registry);
  i18n.translateDocument(document);
  assert.equal(text.nodeValue,'Inventory');
  assert.equal(heading.childNodes[1],dot);
  assert.equal(document.documentElement.lang,'en');
  assert.equal(input.attrs['aria-label'],'Search filament');
  assert.equal(input.value,'User data');
});
test('language initialization honors saved choice and falls back for unavailable or unknown catalogs',async()=>{
  for(const [preferred,available,expected] of [['en',true,'en'],['en',false,'da'],['../../secret',true,'da']]){
    const calls=[];
    const {namespace:i18n}=await moduleFixture({window:{location:{href:'http://localhost/'}},
      localStorage:{getItem:()=>preferred},fetch:async url=>{
        calls.push(url);
        return {ok:url!=='/locales/en.json'||available,json:async()=>url.endsWith('/index.json')?registry:url.endsWith('/da.json')?danish:{language:'en',locale:'en-GB',messages:{}}};
      },
    });
    await i18n.initI18n();
    assert.equal(i18n.getLanguage(),expected);
    assert.ok(calls.every(url=>/^\/locales\/(index|da|en)\.json$/.test(url)));
  }
});
test('language selection persists the choice and retains the current deep link',async()=>{
  const select={value:'da'},error={hidden:true},saved=[],assigned=[];
  const {namespace:i18n}=await moduleFixture({document:{querySelector:s=>s==='#language-select'?select:error},
    window:{location:{href:'http://localhost/?q=keep#spool/stable',assign:url=>assigned.push(url)}},
    localStorage:{setItem:(...args)=>saved.push(args)},fetch:async()=>({ok:true,json:async()=>({language:'en',locale:'en-GB',messages:{}})}),
  });
  i18n.configureI18n(danish,danish,registry);
  i18n.initLanguagePicker();
  select.value='en';
  await select.onchange();
  assert.deepEqual(saved,[['filamentdb.language','en']]);
  const result=new URL(assigned[0]);
  assert.equal(result.hash,'#spool/stable');
  assert.equal(result.searchParams.get('q'),'keep');
  assert.equal(result.searchParams.get('lang'),'en');
});
test('numbers and request language follow the catalog while API status codes stay unchanged',async()=>{
  const nodes=new Map(),calls=[];
  const context=vm.createContext({Intl,URL,window:{location:{hash:''},addEventListener(){}},
    document:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{value:'',dataset:{},innerHTML:'',addEventListener(){},classList:{toggle(){}},setAttribute(){}});return nodes.get(selector);}},
    fetch:async(url,options)=>{
      calls.push({url,options});
      const result=url==='/api/filaments'?[{id:1,name:'Refill',material:'PLA',purchase_format:'refill',remaining:500,weight:1000}]:url==='/api/locations'||url==='/api/material-types'?[]:{status:'pending'};
      return {ok:true,json:async()=>result};
    },
  });
  const graph=await loadFrontend(context,[],{init:false,exposeInternals:false});
  const i18n=graph.get('i18n.js');
  i18n.configureI18n({language:'en',locale:'en-GB',messages:{
    [keyFor('Afventer')]:'Pending',
    'ui.enter_dc8659':'Entrée',
    [keyFor('Refill')]:'Refill product',
    [keyFor('{p0} refill · {p1} ikke angivet')]:'{p0} refills · {p1} unspecified',
  }},danish,registry);
  assert.equal(graph.get('core.js').number(1234.5),'1,234.5');
  await graph.get('core.js').request('/api/prints',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'pending'})});
  assert.equal(calls[0].options.headers['Accept-Language'],'en');
  assert.equal(JSON.parse(calls[0].options.body).status,'pending');
  graph.get('inventory.js').initInventory();
  let clicked=0;
  nodes.get('#cards').onkeydown({key:'Enter',preventDefault(){},target:{matches:()=>true,click(){clicked++;}}});
  assert.equal(clicked,1,'keyboard event codes must not be translated');
  await graph.get('inventory-data.js').fetchInventory();
  graph.get('dashboard.js').renderDashboard();
  assert.equal(nodes.get('#purchase-summary').textContent,'1 refills · 0 unspecified');
  assert.equal(graph.get('inventory-data.js').inventoryState.spools[0].purchase_format,'refill');
  context.fetch=async()=>({ok:false,json:async()=>({error:'Fallback message',error_key:'api.new_version'})});
  await assert.rejects(graph.get('core.js').request('/api/prints'),/Fallback message/);
});
test('every static and JavaScript translation reference exists in the Danish catalog',()=>{
  const ids=new Set(Object.keys(danish.messages));
  for(const filename of fs.readdirSync('static').filter(name=>name.endsWith('.js'))){
    const source=fs.readFileSync(path.join('static',filename),'utf8');
    for(const match of source.matchAll(/\b(?:t|th)\(["']([^"']+)["']/g))assert.ok(ids.has(match[1]),filename+': '+match[1]);
  }
  const html=fs.readFileSync('static/index.html','utf8');
  for(const match of html.matchAll(/data-i18n-(?:placeholder|title|aria-label|alt)="([^"]+)"/g))assert.ok(ids.has(match[1]),match[1]);
  for(const match of html.matchAll(/data-i18n-text="([^"]+)"/g)){
    for(const item of match[1].split('|'))assert.ok(ids.has(item.slice(item.indexOf(':')+1)),item);
  }
});

test('shipped English catalog covers all default messages and preserves interpolation parameters',async()=>{
  const english=JSON.parse(fs.readFileSync('static/locales/en.json','utf8'));
  const languages=JSON.parse(fs.readFileSync('static/locales/index.json','utf8'));
  assert.equal(languages.default,'da');
  assert.equal(english.language,'en');
  assert.equal(english.locale,'en-GB');
  assert.ok(languages.languages.some(language=>language.code==='en' && language.name==='English' && language.locale===english.locale));
  assert.deepEqual(Object.keys(english.messages).sort(),Object.keys(danish.messages).sort());
  for(const [key,value] of Object.entries(danish.messages)){
    const translated=english.messages[key];
    assert.equal(typeof translated,'string',key);
    assert.ok(translated.trim(),key);
    const parameters=text=>[...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match=>match[1]).sort();
    assert.deepEqual(parameters(translated),parameters(value),key);
  }
  for(const [query,expected] of [['','da'],['?lang=en','en']]){
    const {namespace:i18n}=await moduleFixture({window:{location:{href:'http://localhost/'+query}},
      fetch:async url=>({ok:true,json:async()=>url.endsWith('/index.json')?languages:url.endsWith('/en.json')?english:danish}),
    });
    await i18n.initI18n();
    assert.equal(i18n.getLanguage(),expected);
    assert.equal(i18n.t(keyFor('Lager')),expected==='en'?'Inventory':'Lager');
    if(expected==='en'){
      assert.equal(i18n.t(keyFor('Erfaringer')),'Lessons learned');
      assert.equal(i18n.t(keyFor('Registrér forbrug på {p1}'),{p1:'PLA Basic'}),'Record consumption for PLA Basic');
      assert.equal(i18n.tn(keyFor('spole'),keyFor('spoler'),1),'spool');
      assert.equal(i18n.tn(keyFor('spole'),keyFor('spoler'),2),'spools');
    }
  }
});
