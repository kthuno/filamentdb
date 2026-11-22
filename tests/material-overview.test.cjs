const {test, before} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const nodes = new Map();
const context = vm.createContext({Intl, URL, window: {location: {hash: ''}, addEventListener() {}}, document: {querySelector(selector) {
  if (!nodes.has(selector)) nodes.set(selector, {value: '', dataset: {}, addEventListener() {}, classList: {toggle() {}}, setAttribute() {}});
  return nodes.get(selector);
}}});
const {loadFrontend} = require('./frontend-loader.cjs');
before(async () => { await loadFrontend(context); });

test('groups variants, combines colors and manufacturers, counts empty rolls, and sorts by remaining weight', () => {
  context.records = [
    {material:'PLA Basic', remaining:500, manufacturer:'A'},
    {material:' pla  BASIC ', remaining:1000, manufacturer:'B'},
    {material:'PLA Basic', remaining:0},
    {material:'PETG Matte', remaining:2000, purchase_format:'refill'},
    {material:'PLA Matte', remaining:100},
  ];
  const result = JSON.parse(vm.runInContext('JSON.stringify(summarizeMaterials(records))', context));
  assert.deepEqual(result, [
    {name:'PETG Matte', remaining:2000, total:1, available:1},
    {name:'PLA Basic', remaining:1500, total:3, available:2},
    {name:'PLA Matte', remaining:100, total:1, available:1},
  ]);
  assert.equal(result.reduce((sum, item) => sum + item.remaining, 0), 3600);
  vm.runInContext('inventoryState.spools = records.map((s,id) => ({...s,id,name:"Test",weight:1000,diameter:1.75})); render()', context);
  const overview = nodes.get('#material-overview').innerHTML;
  nodes.get('#search').value = 'no match';
  vm.runInContext('render()', context);
  assert.equal(nodes.get('#material-overview').innerHTML, overview);
  assert.equal(nodes.get('#materials').textContent, 3);
});

test('renders empty overview and escapes material names', () => {
  vm.runInContext('inventoryState.spools = []; render()', context);
  assert.match(nodes.get('#material-overview').innerHTML, /Tilføj filament/);
  vm.runInContext('inventoryState.spools = [{material:"<PLA>",remaining:0,weight:1000}]; render()', context);
  assert.match(nodes.get('#material-overview').innerHTML, /&lt;PLA&gt;/);
  assert.doesNotMatch(nodes.get('#material-overview').innerHTML, /<PLA>/);
});

test('identical rolls share one card with summed weight and individual edit buttons', () => {
  context.records = [
    {id:1,name:'PLA White',material:'PLA Basic',manufacturer:'Bambu',color_hex:'#ffffff',weight:1000,remaining:200,location:'AMS'},
    {id:2,name:'PLA White',material:'PLA Basic',manufacturer:'Bambu',color_hex:'#ffffff',weight:1000,remaining:1000,location:'Shelf'},
  ];
  const groups = JSON.parse(vm.runInContext('JSON.stringify(groupFilaments(records))',context));
  assert.equal(groups.length,1);
  assert.equal(groups[0].remaining,1200);
  assert.equal(groups[0].weight,2000);
  assert.equal(groups[0].location,'Flere placeringer');
  nodes.get('#search').value = '';
  vm.runInContext('inventoryState.spools = records; render()', context);
  const cards = nodes.get('#cards').innerHTML;
  assert.equal((cards.match(/<article /g) || []).length,1);
  assert.match(cards,/× 2 spoler/);
  assert.match(cards,/data-edit="1"/);
  assert.match(cards,/data-edit="2"/);
  assert.doesNotMatch(cards,/Spole #|aria-label="(?:Redigér spole|QR-label til spole) [12]"/);
  nodes.get('#stock-filter').value = 'low';
  vm.runInContext('inventoryState.spools[0].remaining = 100; render()',context);
  assert.doesNotMatch(nodes.get('#cards').innerHTML,/× 2 spoler/);
  assert.match(nodes.get('#cards').innerHTML,/data-edit="1"/);
  assert.doesNotMatch(nodes.get('#cards').innerHTML,/data-edit="2"/);
  nodes.get('#stock-filter').value = '';
});

test('different colors, types, weights and purchase formats remain separate', () => {
  context.base = {name:'PLA',material:'PLA Basic',color_hex:'#ffffff',weight:1000,remaining:1000,purchase_format:'spool'};
  const count = vm.runInContext("groupFilaments([base, {...base,color_hex:'#000000'}, {...base,material:'PLA Matte'}, {...base,weight:500}, {...base,purchase_format:'refill'}]).length",context);
  assert.equal(count,5);
});


test('usage history shows total, spool name, escaped notes and delete actions', () => {
  vm.runInContext(`usageState.entries = [{id: 9, filament_id: 2, name: 'PLA', material: 'PLA Basic', manufacturer: 'Test', grams: 125, created_at: '2026-11-08 10:00:00', note: '<script>oops</script>'}]; renderUsage()`, context);
  assert.match(nodes.get('#usage-total').textContent, /0,125 kg/);
  assert.doesNotMatch(nodes.get('#usage-list').innerHTML, /Spole #2/);
  assert.match(nodes.get('#usage-list').innerHTML, /data-delete-usage="9"/);
  assert.match(nodes.get('#usage-list').innerHTML, /&lt;script&gt;/);
});

test('quick consumption prefers remembered available spool, then active spools', () => {
  context.records = [{id:1,remaining:0,active_slot:'AMS 1'},{id:2,remaining:500,active_slot:''},{id:3,remaining:800,active_slot:'AMS 2'}];
  assert.equal(vm.runInContext('preferredSpool(records, 2).id',context),2);
  assert.equal(vm.runInContext('preferredSpool(records, 1).id',context),3);
  assert.equal(vm.runInContext('preferredSpool([], null)',context),undefined);
});

test('add more copies product fields but resets individual spool state', () => {
  const fields = {};
  const keys = ['id','quantity','name','manufacturer','material','color','color_hex','transparency','product_id','product_url','purchase_format','weight','remaining','price','diameter','nozzle_temp','bed_temp','purchase_date','opened_date','location','active_slot','notes'];
  for(const key of keys) fields[key] = {value:'',focus(){}};
  fields.namedItem = key => fields[key];
  nodes.get('#form').elements = fields;
  nodes.get('#form').reset = () => { for(const key of keys) fields[key].value = ''; fields.quantity.value='1'; };
  context.document.querySelector('#editor').showModal = () => {};
  vm.runInContext(`inventoryState.spools = [{id:7,name:'Blue PLA',manufacturer:'Test',material:'PLA Basic',weight:1000,remaining:125,active_slot:'AMS 1',location:'Old box',opened_date:'2026-01-01',notes:'Old note',price:150,product_url:'https://shop.example/pla'}]; addMore(7)`,context);
  assert.equal(fields.name.value,'Blue PLA');
  assert.equal(fields.remaining.value,1000);
  assert.equal(fields.price.value,150);
  assert.equal(fields.active_slot.value,'');
  assert.equal(fields.location.value,'');
  assert.equal(fields.opened_date.value,'');
  assert.equal(fields.notes.value,'');
  assert.equal(fields.id.value,'');
  assert.match(fields.purchase_date.value,/^\d{4}-\d{2}-\d{2}$/);
});

test('QR label encodes a permanent deep link locally with a quiet zone', () => {
  context.URL = URL;
  context.window.location.href = 'https://filament.example.com/#archive';

  const link = vm.runInContext("spoolLink({label_token:'abc123'})",context);
  assert.equal(link,'https://filament.example.com/#spool/abc123');
  const svg = vm.runInContext("qrSvg(spoolLink({label_token:'abc123'}))",context);
  assert.match(svg,/<svg/);
  assert.match(svg,/fill="white"/);
  assert.match(svg,/M4,4/);
  assert.doesNotMatch(svg,/<script/);
});

test('deep link opens matching spool after initial load without reopening on refresh', async () => {
  const opened = [];
  context.opened = opened;
  vm.runInContext("openConsumption = async id => opened.push(id); inventoryState.spools = [{id:9,label_token:'stable'}]; inventoryState.loaded = false; lastHandledLink = null",context);
  context.window.location.hash = '#spool/stable';
  await vm.runInContext('handleSpoolLink()',context);
  assert.deepEqual(opened,[]);
  await vm.runInContext('inventoryState.loaded = true; handleSpoolLink()',context);
  assert.deepEqual(opened,[9]);
  await vm.runInContext('handleSpoolLink()',context);
  assert.deepEqual(opened,[9]);
  context.window.location.hash = '#archive';
  await vm.runInContext('handleSpoolLink()',context);
  context.window.location.hash = '#spool/stable';
  await vm.runInContext('handleSpoolLink()',context);
  assert.deepEqual(opened,[9,9]);
});

test('card and member clicks edit only the selected spool; group cards expand', () => {
  const edited = [];
  context.edited = edited;
  vm.runInContext('edit = id => edited.push(id)',context);
  const handler = nodes.get('#cards').onclick;
  handler({target:{closest: selector => selector === '[data-edit]' ? {dataset:{edit:'2'}} : null}});
  assert.deepEqual(edited,[2]);
  handler({target:{closest: selector => selector === 'button, a, summary' ? {} : null}});
  assert.deepEqual(edited,[2]);
  const details = {open:false};
  handler({target:{closest: selector => selector === '[data-expand]' ? {querySelector:() => details} : null}});
  assert.equal(details.open,true);
  assert.doesNotMatch(nodes.get('#cards').innerHTML,/>Redigér ↗<\/button>/);
});

test('keyboard activates focused cards without hijacking nested controls', () => {
  let clicked=0;
  let prevented=0;
  const handler = nodes.get('#cards').onkeydown;
  handler({key:'Enter',preventDefault:() => prevented++,target:{matches:() => true,click:() => clicked++}});
  handler({key:' ',preventDefault:() => prevented++,target:{matches:() => true,click:() => clicked++}});
  handler({key:'Enter',preventDefault:() => prevented++,target:{matches:() => false,click:() => clicked++}});
  assert.equal(clicked,2);
  assert.equal(prevented,2);
});


test('project usage groups lines into one entry with total and whole-print deletion', () => {
  vm.runInContext(`usageState.entries = [
    {id:1, print_id:4, project_name:'<Sign>',print_date:'2026-11-08',project_note:'Test',filament_id:1,name:'White',material:'PLA',grams:85},
    {id:2, print_id:4, project_name:'<Sign>',print_date:'2026-11-08',project_note:'Test',filament_id:2,name:'Black',material:'PLA',grams:24},
    {id:3,print_id:null,filament_id:3,name:'Blue',material:'PLA',grams:8,created_at:'2026-11-08 10:00:00'}
  ]; renderUsage()`,context);
  const html = nodes.get('#usage-list').innerHTML;
  assert.equal((html.match(/class="usage-record"/g)||[]).length,2);
  assert.match(html,/109 g/);
  assert.match(html,/&lt;Sign&gt;/);
  assert.match(html,/data-delete-print="4"/);
  assert.match(html,/data-delete-usage="3"/);
  assert.doesNotMatch(html,/data-delete-usage="1"/);
  assert.doesNotMatch(html,/Spole #/);
});

test('project spool chooser prioritizes active spools and excludes selected and empty rolls', () => {
  context.choices = [{id:1,name:'White',remaining:500},{id:2,name:'Black',remaining:500,active_slot:'AMS 2'},{id:3,name:'Blue',remaining:0}];
  assert.equal(vm.runInContext("printCandidates(choices, [], '')[0].id",context),2);
  assert.equal(vm.runInContext("printCandidates(choices, [{filament_id:2}], '').length",context),1);
  assert.equal(vm.runInContext("printCandidates(choices, [], 'black')[0].id",context),2);
});


test('location sort orders slots numerically, keeps unplaced last and splits grouped cards', () => {
  context.records = [
    {id:1,name:'PLA',material:'PLA',remaining:500,weight:1000,location:'AMS 10 · slot 1'},
    {id:2,name:'PLA',material:'PLA',remaining:500,weight:1000,location:''},
    {id:3,name:'PLA',material:'PLA',remaining:500,weight:1000,location:'AMS 2 · slot 4'},
    {id:4,name:'PLA',material:'PLA',remaining:500,weight:1000,location:'AMS 2 · slot 1'},
  ];
  assert.equal(vm.runInContext('records.slice().sort(compareLocations).map(s=>s.id).join(",")',context),'4,3,1,2');
  assert.equal(vm.runInContext("['Boks 10','Boks 2','Boks 1'].sort(compareLocationNames).join(', ')",context),'Boks 1, Boks 2, Boks 10');
  assert.equal(vm.runInContext("[{id:10,location:'Boks 10'},{id:2,location:'Boks 2'},{id:1,location:'Boks 1'}].sort(compareLocations).map(s=>s.id).join(',')",context),'1,2,10');
  nodes.get('#sort').value = 'location'; nodes.get('#search').value = '';
  vm.runInContext('inventoryState.spools = records; render()',context);
  const cards = nodes.get('#cards').innerHTML;
  assert.equal((cards.match(/<article /g)||[]).length,4);
  assert.ok(cards.indexOf('data-edit="4"') < cards.indexOf('data-edit="3"'));
  nodes.get('#sort').value = '';
});

test('defined location picker disables occupied slots and keeps the edited slot available', () => {
  vm.runInContext(`inventoryState.locations = [{id:1,name:'<AMS>',kind:'ams_2_pro'},{id:2,name:'Box',kind:'box'}];
    inventoryState.spools = [{id:10,location_id:1,location_slot:2},{id:11,location_id:1,location_slot:4}];
    populateLocations(10)`,context);
  const html = nodes.get('#location-picker').innerHTML;
  assert.match(html, /value="1:4" disabled/);
  assert.doesNotMatch(html, /value="1:2" disabled/);
  assert.match(html, /&lt;AMS&gt;/);
  assert.equal(nodes.get('#location-picker').value,'1:2');
  vm.runInContext('populateLocations()',context);
  assert.match(nodes.get('#location-picker').innerHTML, /value="1:2" disabled/);
  assert.equal(nodes.get('#form').elements.location.disabled,false);
});


test('AMS location derives active slot and clears it when moving away', () => {
  const fields = nodes.get('#form').elements;
  fields.active_slot.dataset = {};
  fields.remaining.value = 500;
  vm.runInContext("inventoryState.locations = [{id:1,name:'Printer AMS',kind:'ams_2_pro'},{id:2,name:'Drybox',kind:'box'}]",context);
  nodes.get('#location-picker').value = '1:3';
  vm.runInContext('syncLocationFields()',context);
  assert.equal(fields.active_slot.value,'Printer AMS · slot 3');
  assert.equal(fields.active_slot.disabled,true);
  assert.equal(nodes.get('#active-slot-field').hidden,true);
  fields.remaining.value = 0;
  vm.runInContext('syncLocationFields()',context);
  assert.equal(fields.active_slot.value,'');
  nodes.get('#location-picker').value = '2:1';
  vm.runInContext('syncLocationFields()',context);
  assert.equal(fields.active_slot.disabled,false);
  assert.equal(nodes.get('#active-slot-field').hidden,false);
  fields.active_slot.value = 'External';
  nodes.get('#location-picker').value = '';
  vm.runInContext('syncLocationFields()',context);
  assert.equal(fields.active_slot.value,'External');
});


test('locations edit link opens the selected spool without leaving locations', async () => {
  context.window.location.hash = '#locations';
  const opened = [];
  context.adminOpened = opened;
  vm.runInContext('edit = id => adminOpened.push(id)',context);
  await nodes.get('#location-list').onclick({target:{closest: selector => selector === '[data-open-spool]' ? {dataset:{openSpool:'42'}} : null}});
  assert.equal(context.window.location.hash,'#locations');
  assert.deepEqual(opened,[42]);
});

test('bulk QR labels split into pages of nine and keep spool-specific links and label content', () => {
  context.bulkRecords = Array.from({length:10},(_,i) => ({id:i+1,label_token:`permanent-${i+1}`,name:'<White>',manufacturer:'Test',material:'PLA Basic',color:'Hvid',product_id:i === 9 ? '' : 'SKU-001'}));
  context.encodedLinks = [];
  vm.runInContext('originalQrSvg = qrSvg; qrSvg = link => { encodedLinks.push(link); return originalQrSvg(link); }',context);
  let html;
  try { html = vm.runInContext('labelPages(bulkRecords)',context); }
  finally { vm.runInContext('qrSvg = originalQrSvg',context); }
  assert.equal((html.match(/class="label-sheet"/g)||[]).length,2);
  const pages = html.split('<section class="label-sheet"').slice(1);
  assert.equal((pages[0].match(/class="sheet-label"/g)||[]).length,9);
  assert.equal((pages[1].match(/class="sheet-label"/g)||[]).length,1);
  assert.equal((html.match(/<svg/g)||[]).length,10);
  assert.match(html,/&lt;White&gt;/);
  assert.match(html,/class="label-material" style="--label-color:#282a36">PLA Basic<\/strong>/);
  assert.match(html,/Test · Hvid/);
  assert.match(html,/Produkt-id: SKU-001/);
  assert.match(html,/Produkt-id ikke angivet/);
  assert.equal(new Set(context.encodedLinks).size,10);
  assert.ok(context.encodedLinks.every((link,i) => link.endsWith(`#spool/permanent-${i+1}`)));
});

test('bulk QR overview handles empty inventory and generation errors without enabling print', () => {
  vm.runInContext('inventoryState.spools = []; showAllLabels()',context);
  assert.equal(nodes.get('#all-labels-print').disabled,true);
  assert.equal(nodes.get('#all-labels-panel').hidden,false);
  assert.equal(nodes.get('#all-labels-pages').innerHTML,'');
  assert.match(nodes.get('#all-labels-summary').textContent,/Ingen spoler/);
  vm.runInContext('inventoryState.spools = bulkRecords; showAllLabels()',context);
  assert.equal(nodes.get('#all-labels-print').disabled,false);
  assert.match(nodes.get('#all-labels-summary').textContent,/10 labels · 2 sider/);
  vm.runInContext('originalQrSvg = qrSvg; qrSvg = () => { throw new Error("QR unavailable"); }',context);
  try {
    vm.runInContext('showAllLabels()',context);
    assert.equal(nodes.get('#all-labels-print').disabled,true);
    assert.equal(nodes.get('#all-labels-pages').innerHTML,'');
    assert.match(nodes.get('#all-labels-error').textContent,/kunne ikke genereres/);
  } finally { vm.runInContext('qrSvg = originalQrSvg',context); }
});

test('project thumbnail links to the stored image and escapes its description', () => {
  vm.runInContext(`usageState.entries = [{id:901,print_id:42,project_name:'<Skilt>',print_date:'2026-11-12',project_note:'',grams:12,name:'PLA',material:'PLA',has_image:1}]; renderUsage()`, context);
  const html = nodes.get('#usage-list').innerHTML;
  assert.match(html, /class="print-thumbnail"/);
  assert.match(html, /src="\/api\/prints\/42\/image"/);
  assert.match(html, /alt="Billede af &lt;Skilt&gt;"/);
  vm.runInContext('usageState.entries[0].has_image = 0; renderUsage()', context);
  assert.doesNotMatch(nodes.get('#usage-list').innerHTML, /print-thumbnail/);
});

test('print editing offers the previous consumption even on an empty spool', () => {
  vm.runInContext(`printDraft.originalItems = [{filament_id:81,grams:1000}]; inventoryState.spools = [{id:81,name:'Tom spole',remaining:0,material:'PLA'}]; printDraft.items = [{filament_id:81,grams:1000}]; renderPrintItems()`, context);
  assert.match(nodes.get('#print-items').innerHTML, /max="1000"/);
  assert.match(nodes.get('#print-items').innerHTML, /value="1000"/);
  vm.runInContext('printDraft.items = []; renderPrintCandidates()', context);
  assert.match(nodes.get('#print-spool').innerHTML, /value="81"/);
  vm.runInContext('printDraft.originalItems = []; renderPrintCandidates()', context);
  assert.doesNotMatch(nodes.get('#print-spool').innerHTML, /value="81"/);
});

test('usage statistics count project lines once, use print dates and combine rolls', () => {
  vm.runInContext(`usageState.entries = [
    {id:1,print_id:10,print_date:'2025-12-31',created_at:'2026-01-02 10:00:00',grams:100,manufacturer:'A',name:'White',material:'PLA Basic',color:'White'},
    {id:2,print_id:10,print_date:'2025-12-31',created_at:'2026-01-02 10:00:00',grams:50,manufacturer:'A',name:'White',material:' pla  basic ',color:'White'},
    {id:3,print_id:null,created_at:'2026-01-02 10:00:00',grams:25,manufacturer:'B',name:'<Black>',material:'PETG',color:'Black'}
  ]`, context);
  const all = JSON.parse(vm.runInContext('JSON.stringify(summarizeUsage(usageState.entries))', context));
  assert.equal(all.grams,175);
  assert.equal(all.registrations,2);
  assert.deepEqual(all.months,[{label:'2025-12',grams:150},{label:'2026-01',grams:25}]);
  assert.equal(all.materials.length,2);
  assert.equal(all.materials[0].grams,150);
  assert.equal(all.filaments.length,2);
  assert.equal(all.filaments[0].grams,150);
  const year = JSON.parse(vm.runInContext("JSON.stringify(summarizeUsage(usageState.entries,'2025'))", context));
  assert.equal(year.grams,150);
  assert.equal(year.registrations,1);
  nodes.get('#usage-statistics-year').value = '2026';
  vm.runInContext('renderUsageStatistics()',context);
  assert.match(nodes.get('#usage-filaments').innerHTML,/&lt;Black&gt;/);
  assert.doesNotMatch(nodes.get('#usage-filaments').innerHTML,/<Black>/);
  assert.match(nodes.get('#usage-materials').innerHTML,/100/);
  vm.runInContext('usageState.entries = []; renderUsage()',context);
  assert.equal(nodes.get('#usage-statistics-year').value,'');
  assert.match(nodes.get('#usage-monthly').innerHTML,/Intet registreret forbrug/);
});

test('project links appear only in the dialog and follow valid input', () => {
  vm.runInContext(`usageState.entries = [{id:1,print_id:3,project_name:'Model',print_date:'2026-11-12',project_note:'',grams:10,name:'PLA',material:'PLA',project_url:'https://example.com/model'}]; renderUsage()`, context);
  assert.doesNotMatch(nodes.get('#usage-list').innerHTML,/Åbn projekt|class="project-link"/);
  vm.runInContext("$('#print-project-open')",context);
  const anchor = nodes.get('#print-project-open');
  const attributes = new Map();
  anchor.setAttribute = (name,value) => attributes.set(name,value);
  anchor.removeAttribute = name => attributes.delete(name);
  nodes.get('#print-project-url').value = 'https://example.com/model?a=1&b=2';
  vm.runInContext('updatePrintProjectLink()',context);
  assert.equal(anchor.hidden,false);
  assert.equal(attributes.get('href'),'https://example.com/model?a=1&b=2');
  for (const value of ['', 'javascript:alert(1)', 'https://user:pass@example.com']) {
    nodes.get('#print-project-url').value = value;
    nodes.get('#print-project-url').oninput();
    assert.equal(anchor.hidden,true);
    assert.equal(attributes.has('href'),false);
  }
});

test('history filters combine dates, material and spool while preserving whole projects', () => {
  vm.runInContext(`usageState.entries = [
    {id:1,filament_id:11,print_id:5,project_name:'Vase',project_note:'Til stuen',print_date:'2025-12-31',created_at:'2026-01-02 00:00:00',name:'Hvid',material:'PLA Basic',grams:100},
    {id:2,filament_id:12,print_id:5,project_name:'Vase',project_note:'Til stuen',print_date:'2025-12-31',created_at:'2026-01-02 00:00:00',name:'Sort',material:'PETG',grams:50},
    {id:3,filament_id:11,print_id:null,created_at:'2026-01-02 00:00:00',name:'Hvid',material:'PLA Basic',note:'Test',grams:20}
  ]`, context);
  function filtered(filters) {
    context.historyFilters = filters;
    return JSON.parse(vm.runInContext('JSON.stringify(filterUsageGroups(usageState.entries,historyFilters))', context));
  }
  const project = filtered({query:' VASE ',from:'2025-12-31',to:'2025-12-31',material:'pla basic',spool:'11'});
  assert.equal(project.length,1);
  assert.equal(project[0].grams,150);
  assert.equal(project[0].items.length,2);
  assert.equal(filtered({material:'petg',spool:'11'}).length,0);
  assert.equal(filtered({query:'STUEN'}).length,1);
  assert.equal(filtered({from:'2026-01-02',to:'2026-01-02'})[0].grams,20);
  assert.equal(filtered({from:'2026-02-01',to:'2026-01-01'}).length,0);
  vm.runInContext('renderUsage()',context);
  nodes.get('#usage-material').value = 'petg';
  vm.runInContext('renderUsageHistory()',context);
  assert.match(nodes.get('#usage-total').textContent,/0,15 kg/);
  assert.match(nodes.get('#usage-filter-total').textContent,/1 af 2 registreringer/);
  assert.match(nodes.get('#usage-list').innerHTML,/Hvid/);
  nodes.get('#usage-search').value = 'Findes ikke';
  vm.runInContext('renderUsageHistory()',context);
  assert.match(nodes.get('#usage-list').innerHTML,/Ingen registreringer matcher/);
  nodes.get('#usage-reset').onclick();
  assert.match(nodes.get('#usage-filter-total').textContent,/2 af 2 registreringer/);
  assert.equal(nodes.get('#usage-search').value,'');
  assert.equal(nodes.get('#usage-material').value,'');
});

test('print again copies saved data into a new draft with current stock and replaceable rolls', async () => {
  for (const selector of ['#print-form','#print-image-preview','#print-dialog','#print-name','#print-project-open']) {
    vm.runInContext(`$(${JSON.stringify(selector)})`,context);
    const node = nodes.get(selector);
    node.reset = () => {};
    node.removeAttribute = () => {};
    node.focus = () => {};
    node.showModal = () => { node.open = true; };
  }
  vm.runInContext(`
    savedRepeatLoad = load; savedRepeatRequest = request;
    repeatRequests = [];
    repeatSource = {archive_file_id:7,id:44,name:'Vase',note:'Original note',project_url:'https://example.com/model',image:'data:image/jpeg;base64,test',print_date:'2020-01-01',status:'failed',duration_minutes:185,items:[{filament_id:81,grams:100}]};
    load = async () => { inventoryState.spools = [{id:81,name:'Tom spole',material:'PLA',remaining:0},{id:82,name:'Ny rulle',material:'PLA',remaining:500}]; };
    request = async (url,options) => { repeatRequests.push({url,options}); return url === '/api/files' ? [{id:7,name:'Model',filename:'model.3mf'}] : url.endsWith('/preview') ? {plates:[]} : repeatSource; };
  `,context);
  try {
    await vm.runInContext('openPrintEditor(44,true)',context);
    assert.equal(vm.runInContext('printDraft.printId',context),null);
    assert.equal(vm.runInContext('printDraft.originalItems.length',context),0);
    assert.equal(vm.runInContext('printAvailable(inventoryState.spools[0])',context),0);
    assert.equal(nodes.get('#print-name').value,'Vase');
    assert.equal(nodes.get('#print-archive-file').value,'7');
    assert.equal(nodes.get('#print-note').value,'Original note');
    assert.equal(nodes.get('#print-project-url').value,'https://example.com/model');
    assert.equal(vm.runInContext('printDraft.image',context),'data:image/jpeg;base64,test');
    assert.notEqual(nodes.get('#print-date').value,'2020-01-01');
    assert.equal(nodes.get('#print-repeat').hidden,true);
    assert.equal(nodes.get('#print-save').textContent,'Gem print');
    assert.equal(nodes.get('#print-status').value,'completed');
    assert.equal(nodes.get('#print-hours').value,'3');
    assert.equal(nodes.get('#print-minutes').value,'5');
    assert.match(nodes.get('#print-items').innerHTML,/max="0"/);
    assert.equal(vm.runInContext('repeatRequests.length',context),3);
    nodes.get('#print-items').onchange({target:{dataset:{printSpool:'81'},value:'82'}});
    assert.equal(vm.runInContext('printDraft.items[0].filament_id',context),82);
    assert.equal(vm.runInContext('printDraft.items[0].grams',context),100);
    assert.equal(vm.runInContext('repeatSource.items[0].filament_id',context),81);
    assert.match(nodes.get('#print-items').innerHTML,/max="500"/);
    await vm.runInContext('openPrintEditor(44)',context);
    assert.equal(vm.runInContext('printDraft.printId',context),44);
    assert.equal(vm.runInContext('printAvailable(inventoryState.spools[0])',context),100);
    assert.equal(nodes.get('#print-repeat').hidden,false);
    assert.equal(nodes.get('#print-status').value,'failed');
  } finally {
    vm.runInContext('load = savedRepeatLoad; request = savedRepeatRequest',context);
  }
});

test('print status labels include failed consumption in history and statistics', () => {
  nodes.get('#usage-reset').onclick();
  vm.runInContext(`usageState.entries = [{id:1,filament_id:1,print_id:3,project_name:'Model',print_date:'2026-11-12',project_note:'Erfaring',grams:100,name:'PLA',material:'PLA',print_status:'failed'}]; renderUsage()`,context);
  assert.match(nodes.get('#usage-list').innerHTML,/print-status failed">Fejlet/);
  assert.match(nodes.get('#usage-filter-total').textContent,/100 g/);
  assert.equal(vm.runInContext('summarizeUsage(usageState.entries).grams',context),100);
  vm.runInContext("usageState.entries[0].print_status = 'completed'; renderUsage()",context);
  assert.match(nodes.get('#usage-list').innerHTML,/print-status completed">Gennemført/);
  assert.equal(vm.runInContext('summarizeUsage(usageState.entries).grams',context),100);
});

test('waste statistics combine failed print usage with extra waste without duplicating either', () => {
  nodes.get('#usage-reset').onclick();
  vm.runInContext(`usageState.entries = [
    {id:1,filament_id:1,print_id:3,print_status:'failed',print_date:'2026-11-12',project_name:'Fejl',project_note:'',grams:100,name:'PLA',material:'PLA'},
    {id:2,filament_id:1,print_id:null,waste_id:7,waste_date:'2026-11-12',waste_reason:'purge',waste_note:'<Extra>',linked_project_name:'Fejl',grams:20,name:'PLA',material:'PLA'},
    {id:3,filament_id:2,print_id:null,waste_id:7,waste_date:'2026-11-12',waste_reason:'purge',waste_note:'<Extra>',linked_project_name:'Fejl',grams:30,name:'PETG',material:'PETG'},
    {id:4,filament_id:1,print_id:null,created_at:'2025-01-01 00:00:00',grams:50,name:'PLA',material:'PLA'}
  ]; renderUsage()`,context);
  const stats = JSON.parse(vm.runInContext('JSON.stringify(summarizeUsage(usageState.entries))',context));
  assert.equal(stats.grams,200);
  assert.equal(stats.wasteGrams,150);
  assert.equal(stats.registrations,3);
  assert.deepEqual(stats.waste,[{label:'Fejlet print',grams:100},{label:'Purge / farveskift',grams:50}]);
  assert.equal(vm.runInContext("summarizeUsage(usageState.entries,'2025').wasteGrams",context),0);
  const html = nodes.get('#usage-list').innerHTML;
  assert.equal((html.match(/data-edit-waste="7"/g)||[]).length,1);
  assert.match(html,/&lt;Extra&gt;/);
  assert.match(nodes.get('#usage-statistics-summary').innerHTML,/75/);
  assert.match(nodes.get('#usage-waste').innerHTML,/Purge \/ farveskift/);
  vm.runInContext('usageState.entries[0].print_status = "completed"; renderUsage()',context);
  assert.equal(vm.runInContext('summarizeUsage(usageState.entries).wasteGrams',context),50);
});

test('waste dialog reuses spool lines but submits a separate waste record only on save', async () => {
  for (const selector of ['#print-form','#print-image-preview','#print-dialog','#waste-reason']) {
    vm.runInContext(`$(${JSON.stringify(selector)})`,context);
    const node = nodes.get(selector);
    node.reset = () => {};
    node.removeAttribute = () => {};
    node.focus = () => {};
    node.showModal = () => { node.open = true; };
    node.close = () => { node.open = false; };
  }
  vm.runInContext(`savedWasteLoad = load; savedWasteRequest = request; savedWasteUsage = loadUsage; savedWasteNotify = notify;
    wasteRequests = [];
    load = async () => { inventoryState.spools = [{id:81,name:'PLA',material:'PLA',remaining:400}]; };
    loadUsage = async () => {};
    notify = () => {};
    request = async (url,options) => {
      wasteRequests.push({url,options});
      if (url === '/api/prints') return [{id:44,name:'Projekt',print_date:'2026-11-12'}];
      if (url === '/api/waste/7' && !options) return {id:7,waste_date:'2026-11-12',reason:'purge',note:'Extra',project_id:44,items:[{filament_id:81,grams:50}]};
      return {ok:true};
    };`,context);
  try {
    await vm.runInContext('openWasteEditor()',context);
    assert.equal(vm.runInContext('wasteRequests.length',context),1);
    assert.equal(nodes.get('#print-name').required,false);
    assert.equal(nodes.get('#print-project-url').disabled,true);
    assert.equal(nodes.get('#waste-reason-field').hidden,false);
    vm.runInContext('printDraft.items = [{filament_id:81,grams:50}]',context);
    nodes.get('#waste-reason').value = 'purge';
    nodes.get('#waste-project').value = '44';
    await nodes.get('#print-form').onsubmit({preventDefault(){}});
    const post = JSON.parse(vm.runInContext('JSON.stringify(wasteRequests.find(item => item.options?.method === "POST"))',context));
    assert.equal(post.url,'/api/waste');
    const body = JSON.parse(post.options.body);
    assert.equal(body.reason,'purge');
    assert.equal(body.project_id,44);
    assert.deepEqual(body.items,[{filament_id:81,grams:50}]);
    await vm.runInContext('openWasteEditor(7)',context);
    assert.equal(vm.runInContext('printDraft.wasteId',context),7);
    assert.equal(vm.runInContext('printAvailable(inventoryState.spools[0])',context),450);
    await nodes.get('#print-form').onsubmit({preventDefault(){}});
    assert.equal(vm.runInContext('wasteRequests.at(-1).options.method',context),'PUT');
  } finally {
    vm.runInContext('load = savedWasteLoad; request = savedWasteRequest; loadUsage = savedWasteUsage; notify = savedWasteNotify; setWasteMode(false)',context);
  }
});

test('archived rolls are filtered before grouping and excluded from physical inventory counts', () => {
  for (const selector of ['#search','#material-filter','#stock-filter','#archive-filter']) nodes.get(selector).value = '';
  nodes.get('#sort').value = 'new';
  vm.runInContext(`inventoryState.spools = [
    {id:1,name:'PLA',manufacturer:'A',material:'PLA',remaining:0,weight:1000,purchase_format:'spool',archived:0},
    {id:2,name:'PLA',manufacturer:'A',material:'PLA',remaining:0,weight:1000,purchase_format:'spool',archived:1},
    {id:3,name:'PETG',manufacturer:'A',material:'PETG',remaining:400,weight:1000,purchase_format:'refill',archived:0}
  ]; render()`,context);
  assert.equal(nodes.get('#total').textContent,2);
  assert.equal(nodes.get('#physical-spools').textContent,1);
  assert.doesNotMatch(nodes.get('#cards').innerHTML,/data-edit="2"/);
  const overview = nodes.get('#material-overview').innerHTML;
  nodes.get('#archive-filter').value = 'archived';
  vm.runInContext('render()',context);
  assert.match(nodes.get('#cards').innerHTML,/data-edit="2"/);
  assert.match(nodes.get('#cards').innerHTML,/Arkiveret/);
  assert.doesNotMatch(nodes.get('#cards').innerHTML,/data-edit="1"/);
  assert.equal(nodes.get('#material-overview').innerHTML,overview);
  nodes.get('#archive-filter').value = 'all';
  vm.runInContext('render()',context);
  assert.match(nodes.get('#cards').innerHTML,/data-edit="1"/);
  assert.match(nodes.get('#cards').innerHTML,/data-edit="2"/);
  assert.equal(vm.runInContext('groupFilaments(inventoryState.spools).length',context),3);
  nodes.get('#archive-filter').value = '';
});

test('history sorts complete projects by date, name and total consumption in either direction', () => {
  vm.runInContext(`usageState.entries = [
    {id:1,filament_id:1,print_id:5,project_name:'Zebra',project_note:'',print_date:'2026-01-01',created_at:'2026-12-01 00:00:00',name:'PLA',material:'PLA',grams:100},
    {id:2,filament_id:2,print_id:5,project_name:'Zebra',project_note:'',print_date:'2026-01-01',created_at:'2026-12-01 00:00:00',name:'PETG',material:'PETG',grams:100},
    {id:3,filament_id:1,print_id:6,project_name:'Alfa',project_note:'',print_date:'2026-02-01',name:'PLA',material:'PLA',grams:150}
  ]`,context);
  function ids(sort,direction) {
    context.sortChoice = sort; context.directionChoice = direction;
    return JSON.parse(vm.runInContext('JSON.stringify(sortUsageGroups(groupUsage(usageState.entries),sortChoice,directionChoice).map(group => group.entry.print_id))',context));
  }
  assert.deepEqual(ids('date','desc'),[6,5]);
  assert.deepEqual(ids('date','asc'),[5,6]);
  assert.deepEqual(ids('name','asc'),[6,5]);
  assert.deepEqual(ids('name','desc'),[5,6]);
  assert.deepEqual(ids('grams','desc'),[5,6]);
  assert.deepEqual(ids('grams','asc'),[6,5]);
  nodes.get('#usage-reset').onclick();
  nodes.get('#usage-sort').value = 'grams';
  nodes.get('#usage-direction').value = 'desc';
  vm.runInContext('renderUsage()',context);
  const html = nodes.get('#usage-list').innerHTML;
  assert.ok(html.indexOf('Zebra') < html.indexOf('Alfa'));
  assert.equal((html.match(/data-edit-print="5"/g)||[]).length,1);
  nodes.get('#usage-search').value = 'Alfa';
  vm.runInContext('renderUsageHistory()',context);
  assert.doesNotMatch(nodes.get('#usage-list').innerHTML,/Zebra/);
  assert.match(nodes.get('#usage-filter-total').textContent,/150 g/);
  nodes.get('#usage-reset').onclick();
  assert.equal(nodes.get('#usage-sort').value,'date');
  assert.equal(nodes.get('#usage-direction').value,'desc');
});

test('print time counts each project once, excludes unknown and waste, and follows year', () => {
  vm.runInContext(`usageState.entries = [
    {id:1,print_id:5,project_name:'Test',project_note:'',print_date:'2026-01-01',duration_minutes:185,print_status:'failed',grams:100,name:'PLA',material:'PLA'},
    {id:2,print_id:5,project_name:'Test',project_note:'',print_date:'2026-01-01',duration_minutes:185,print_status:'failed',grams:100,name:'PETG',material:'PETG'},
    {id:3,print_id:6,project_name:'Unknown',project_note:'',print_date:'2026-02-01',duration_minutes:null,grams:150,name:'PLA',material:'PLA'},
    {id:4,print_id:7,project_name:'Old',project_note:'',print_date:'2025-01-01',duration_minutes:60,grams:150,name:'PLA',material:'PLA'},
    {id:5,waste_id:1,waste_date:'2026-01-01',waste_reason:'purge',duration_minutes:999,grams:10,name:'PLA',material:'PLA'}
  ]`,context);
  const stats = JSON.parse(vm.runInContext("JSON.stringify(summarizeUsage(usageState.entries,'2026'))",context));
  assert.equal(stats.printMinutes,185);
  assert.equal(stats.failedMinutes,185);
  assert.equal(stats.timedPrintCount,1);
  assert.equal(stats.printCount,2);
  assert.deepEqual(stats.timeMonths,[{label:'2026-01',grams:185}]);
  assert.equal(vm.runInContext('summarizeUsage(usageState.entries).printMinutes',context),245);
  nodes.get('#usage-reset').onclick();
  vm.runInContext('renderUsage()',context);
  assert.match(nodes.get('#usage-list').innerHTML,/Printtid: 3 t 5 min/);
  assert.match(nodes.get('#usage-list').innerHTML,/Printtid: Ikke angivet/);
  assert.match(nodes.get('#usage-print-time').innerHTML,/3 t 5 min/);
  assert.equal(vm.runInContext('formatPrintTime(null)',context),'Ikke angivet');
  nodes.get('#print-hours').value = '3'; nodes.get('#print-minutes').value = '5';
  assert.equal(vm.runInContext('printDurationInput()',context),185);
  nodes.get('#print-hours').value = ''; nodes.get('#print-minutes').value = '';
  assert.equal(vm.runInContext('printDurationInput()',context),null);
});

test('in-progress prints display their status and count as usage without being waste', () => {
  nodes.get('#usage-reset').onclick();
  vm.runInContext(`usageState.entries = [{id:1,print_id:3,project_name:'I gang',print_date:'2026-11-12',project_note:'',print_status:'in_progress',duration_minutes:60,grams:100,name:'PLA',material:'PLA'}]; renderUsage()`,context);
  assert.match(nodes.get('#usage-list').innerHTML,/print-status in-progress">Igangværende/);
  assert.equal(vm.runInContext('summarizeUsage(usageState.entries).grams',context),100);
  assert.equal(vm.runInContext('summarizeUsage(usageState.entries).wasteGrams',context),0);
});

test('AMS graphics show numbered slots, physical occupancy, safe filament colors and editable rolls', () => {
  vm.runInContext(`inventoryState.spools = [
    {id:1,location_id:5,location_slot:1,name:'<Hvid>',material:'PLA',color:'Hvid',color_hex:'#ffffff',remaining:750,weight:1000},
    {id:2,location_id:5,location_slot:3,name:'Tom',material:'PETG',color_hex:'red;display:none',remaining:0,weight:1000}
  ]`,context);
  const html = vm.runInContext("renderAmsLocation({id:5,name:'AMS <2>',kind:'ams_2_pro'})",context);
  assert.equal((html.match(/class="ams-slot-top"/g)||[]).length,4);
  assert.equal((html.match(/ams-slot ams-slot-vacant/g)||[]).length,2);
  assert.match(html,/2 \/ 4 pladser optaget/);
  assert.match(html,/data-open-spool="1"/);
  assert.match(html,/data-open-spool="2"/);
  assert.match(html,/&lt;Hvid&gt;/);
  assert.match(html,/AMS &lt;2&gt;/);
  assert.match(html,/width:75%/);
  assert.match(html,/Tom spole/);
  assert.match(html,/--filament:#ffffff/);
  assert.doesNotMatch(html,/display:none/);
  const ht = vm.runInContext("renderAmsLocation({id:6,name:'HT',kind:'ams_ht'})",context);
  assert.equal((ht.match(/class="ams-slot-top"/g)||[]).length,1);
  assert.match(ht,/ams-single/);
  assert.match(ht,/0 \/ 1 pladser optaget/);
});

test('dry boxes show a single spool in a container with safe colors, stock and edit action', () => {
  vm.runInContext(`inventoryState.spools = [{id:9,location_id:7,location_slot:1,name:'<Grøn>',manufacturer:'Test',material:'PLA',color:'Grøn',color_hex:'#50fa7b',remaining:250,weight:1000}]`,context);
  const html = vm.runInContext("renderDryBoxLocation({id:7,name:'Boks <1>',kind:'box'})",context);
  assert.match(html,/drybox-visual/);
  assert.match(html,/drybox-lid/);
  assert.match(html,/Boks &lt;1&gt;/);
  assert.match(html,/&lt;Grøn&gt;/);
  assert.match(html,/--filament:#50fa7b/);
  assert.match(html,/width:25%/);
  assert.match(html,/1 \/ 1 plads optaget/);
  assert.equal((html.match(/data-open-spool="9"/g)||[]).length,1);
  vm.runInContext("inventoryState.spools[0].remaining = 0; inventoryState.spools[0].color_hex = 'red;display:none'",context);
  const emptyRoll = vm.runInContext("renderDryBoxLocation({id:7,name:'Boks',kind:'box'})",context);
  assert.match(emptyRoll,/Tom spole/);
  assert.match(emptyRoll,/1 \/ 1 plads optaget/);
  assert.doesNotMatch(emptyRoll,/display:none/);
  vm.runInContext('inventoryState.spools = []',context);
  const vacant = vm.runInContext("renderDryBoxLocation({id:7,name:'Boks',kind:'box'})",context);
  assert.match(vacant,/0 \/ 1 plads optaget/);
  assert.match(vacant,/drybox-vacant/);
  assert.doesNotMatch(vacant,/data-open-spool/);
});

test('six-month chart fills empty months across years and counts every usage line once', () => {
  context.recentEntries = [
    {print_id:1,print_date:'2025-12-31',grams:100},
    {print_id:1,print_date:'2025-12-31',grams:50},
    {created_at:'2026-01-01 00:00:00',grams:25},
    {waste_id:1,waste_date:'2025-11-01',grams:10},
    {print_id:2,print_date:'2025-08-31',grams:999},
    {print_id:3,print_date:'2026-03-01',grams:999},
  ];
  const months = JSON.parse(vm.runInContext('JSON.stringify(recentMonthlyUsage(recentEntries,new Date(2026,1,12)))',context));
  assert.deepEqual(months.map(month=>month.key),['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02']);
  assert.deepEqual(months.map(month=>month.grams),[0,0,10,150,25,0]);
  vm.runInContext('renderRecentUsage([])',context);
  const html = nodes.get('#usage-six-months-chart').innerHTML;
  assert.equal((html.match(/<li /g)||[]).length,6);
  assert.doesNotMatch(html,/NaN|Infinity/);
  assert.match(nodes.get('#usage-six-months-total').textContent,/0 kg/);
});

test('active spool cards show safe color graphics, slot, remaining weight and low-stock indication', () => {
  context.activeRecord = {id:17,name:'<PLA>',active_slot:'AMS 2 Pro · slot 1',material:'PLA Basic',color:'Hvid',color_hex:'#ffffff',remaining:150,weight:1000};
  const html = vm.runInContext('activeSpoolCard(activeRecord)',context);
  assert.match(html,/data-consume="17"/);
  assert.match(html,/active-spool-low/);
  assert.match(html,/&lt;PLA&gt;/);
  assert.match(html,/AMS 2 Pro · slot 1/);
  assert.match(html,/--filament:#ffffff/);
  assert.match(html,/width:15%/);
  assert.match(html,/150/);
  assert.match(html,/Registrér forbrug/);
  vm.runInContext("activeRecord.remaining = 750; activeRecord.color_hex = 'red;display:none'",context);
  const full = vm.runInContext('activeSpoolCard(activeRecord)',context);
  assert.doesNotMatch(full,/active-spool-low|display:none/);
  assert.match(full,/width:75%/);
});

test('pending prints display Afventer without counting as waste', () => {
  nodes.get('#usage-reset').onclick();
  vm.runInContext(`usageState.entries = [{id:1,print_id:3,project_name:'Afventer',print_date:'2026-11-12',project_note:'',print_status:'pending',grams:100,name:'PLA',material:'PLA'}]; renderUsage()`,context);
  assert.match(nodes.get('#usage-list').innerHTML,/print-status pending">Afventer/);
  assert.equal(vm.runInContext('summarizeUsage(usageState.entries).wasteGrams',context),0);
});

test('locations, build plates and QR labels have independent navigation and data loading', async()=>{
  const oldLoad=context.load,oldPlates=context.loadBuildPlates;
  const calls=[];
  context.load=async()=>calls.push('inventory');
  context.loadBuildPlates=async()=>calls.push('plates');
  const pages=['archive','usage','projects','knowledge','locations','build-plates','qr-labels'];
  const attributeSetters=new Map();
  try {
    for(const page of pages) {
      const element=context.document.querySelector('#nav-'+page);
      attributeSetters.set(element,element.setAttribute);
      element.setAttribute=function(name,value){this[name]=value;};
    }
    for(const page of ['locations','build-plates','qr-labels']) {
      context.window.location.hash='#'+page;
      await vm.runInContext('switchView()',context);
      for(const other of pages) {
        assert.equal(nodes.get('#'+other+'-view').hidden,other!==page);
        assert.equal(nodes.get('#nav-'+other)['aria-current'],other===page?'page':'false');
      }
    }
    assert.deepEqual(calls,['inventory','plates','inventory']);
  } finally {
    context.load=oldLoad;
    if(oldPlates===undefined) delete context.loadBuildPlates; else context.loadBuildPlates=oldPlates;
    for(const [element,setter] of attributeSetters) element.setAttribute=setter;
    context.window.location.hash='#archive';
  }
});

test('saved material suggestions escape names and retain defaults', () => {
  vm.runInContext('populateMaterialTypes(["PLA Sparkle", "<PETG>"])',context);
  assert.match(nodes.get('#material-list').innerHTML,/PLA Sparkle/);
  assert.match(nodes.get('#material-list').innerHTML,/&lt;PETG&gt;/);
  assert.doesNotMatch(nodes.get('#material-list').innerHTML,/<PETG>/);
});

test('clicking an overview type filters matching rolls including normalized variants', () => {
  for (const selector of ['#search','#material-filter','#stock-filter','#archive-filter']) nodes.get(selector).value = '';
  vm.runInContext(`inventoryState.spools = [
    {id:101,name:'Sparkle one',material:'PLA Sparkle',remaining:500,weight:1000},
    {id:102,name:'Sparkle two',material:' pla  sparkle ',remaining:200,weight:1000},
    {id:103,name:'Other roll',material:'PETG',remaining:500,weight:1000}
  ]; render()`,context);
  const overview = nodes.get('#material-overview').innerHTML;
  assert.match(overview,/href="#cards" data-filter-material="PLA Sparkle"/);
  let prevented = false;
  nodes.get('#material-overview').onclick({
    target:{closest:selector => selector === '[data-filter-material]' ? {dataset:{filterMaterial:'PLA Sparkle'}} : null},
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented,true);
  assert.equal(nodes.get('#material-filter').value,'PLA Sparkle');
  assert.match(nodes.get('#cards').innerHTML,/Sparkle one/);
  assert.match(nodes.get('#cards').innerHTML,/Sparkle two/);
  assert.doesNotMatch(nodes.get('#cards').innerHTML,/Other roll/);
  assert.equal(nodes.get('#material-overview').innerHTML,overview);
  nodes.get('#material-filter').value = '';
});

test('material color tree sums matching colors and preserves expansion across filtering', () => {
  vm.runInContext(`inventoryState.spools = [
    {id:1,name:'A',material:'PLA Basic',color:'Hvid',color_hex:'#ffffff',remaining:300,weight:1000},
    {id:2,name:'B',material:' pla BASIC ',color:' hvid ',color_hex:'#ffffff',remaining:500,weight:1000},
    {id:3,name:'C',material:'PLA Basic',color:'Hvid',remaining:0,weight:1000},
    {id:4,name:'D',material:'PLA Basic',color:'<Sort>',color_hex:'bad',remaining:100,weight:1000},
    {id:5,name:'E',material:'PETG',color:'Hvid',remaining:900,weight:1000},
    {id:6,name:'F',material:'PLA Basic',color:'Hvid',remaining:700,weight:1000,archived:1}
  ]; expandedMaterials.clear(); render()`,context);
  const colors = JSON.parse(vm.runInContext("JSON.stringify(summarizeMaterialColors(inventoryState.spools.filter(s => !s.archived),'PLA Basic'))",context));
  assert.equal(colors[0].name,'Hvid');
  assert.equal(colors[0].remaining,800);
  assert.equal(colors[0].total,3);
  assert.equal(colors[0].available,2);
  assert.equal(colors[1].color,'#bd93f9');
  let html = nodes.get('#material-overview').innerHTML;
  assert.match(html,/aria-expanded="false"/);
  assert.match(html,/&lt;Sort&gt;/);
  assert.match(html,/3 spoler/);
  const children = {hidden:true};
  context.document.getElementById = () => children;
  const attributes = {};
  nodes.get('#material-overview').onclick({target:{closest:() => ({
    dataset:{toggleMaterial:'PLA Basic'},
    setAttribute(key,value) { attributes[key] = value; },
    getAttribute() { return 'material-colors-0'; }
  })}});
  assert.equal(children.hidden,false);
  assert.equal(attributes['aria-expanded'],'true');
  nodes.get('#search').value = 'does not match';
  vm.runInContext('render()',context);
  html = nodes.get('#material-overview').innerHTML;
  assert.match(html,/data-toggle-material="PLA Basic" aria-expanded="true"/);
  assert.match(html,/800 g/);
  nodes.get('#search').value = '';
  vm.runInContext('expandedMaterials.clear()',context);
});

test('QR label selection prints only checked rolls and repacks selected labels', () => {
  vm.runInContext('inventoryState.spools = bulkRecords; showAllLabels()',context);
  assert.equal((nodes.get('#all-labels-pages').innerHTML.match(/type="checkbox"/g)||[]).length,10);
  assert.equal((nodes.get('#all-labels-pages').innerHTML.match(/ checked /g)||[]).length,10);
  let prints = 0;
  context.window.print = () => { prints++; };
  nodes.get('#all-labels-deselect-all').onclick();
  assert.equal(nodes.get('#all-labels-print').disabled,true);
  assert.equal(nodes.get('#selected-labels-pages').innerHTML,'');
  assert.equal((nodes.get('#all-labels-pages').innerHTML.match(/ checked /g)||[]).length,0);
  nodes.get('#all-labels-print').onclick();
  assert.equal(prints,0);
  for (const id of [1,10]) nodes.get('#all-labels-pages').onchange({target:{closest:()=>({dataset:{labelSpool:String(id)},checked:true})}});
  assert.equal(nodes.get('#all-labels-print').disabled,false);
  assert.match(nodes.get('#all-labels-summary').textContent,/2 labels · 1 side/);
  assert.match(nodes.get('#all-labels-summary').textContent,/2 af 10 valgt/);
  const selected = nodes.get('#selected-labels-pages').innerHTML;
  assert.equal((selected.match(/class="label-sheet"/g)||[]).length,1);
  assert.equal((selected.match(/class="sheet-label"/g)||[]).length,2);
  assert.equal((selected.match(/<svg/g)||[]).length,2);
  assert.doesNotMatch(selected,/checkbox|data-label-spool/);
  nodes.get('#all-labels-print').onclick();
  assert.equal(prints,1);
  nodes.get('#all-labels-pages').onchange({target:{closest:()=>({dataset:{labelSpool:'1'},checked:false})}});
  assert.equal((nodes.get('#selected-labels-pages').innerHTML.match(/class="sheet-label"/g)||[]).length,1);
  nodes.get('#all-labels-select-all').onclick();
  assert.equal((nodes.get('#selected-labels-pages').innerHTML.match(/class="label-sheet"/g)||[]).length,2);
  assert.equal((nodes.get('#all-labels-pages').innerHTML.match(/ checked /g)||[]).length,10);
});

test('inline QR overview prepares only its selected print content and respects single-label printing', () => {
  vm.runInContext('inventoryState.spools = bulkRecords; showAllLabels()',context);
  nodes.get('#qr-labels-view').hidden = false;
  nodes.get('#label-dialog').open = false;
  assert.equal(nodes.get('#all-labels-panel').hidden,false);
  let prints = 0;
  context.window.print = () => {
    prints++;
    assert.equal(nodes.get('#selected-labels-pages').dataset.printActive,'true');
    assert.equal((nodes.get('#selected-labels-pages').innerHTML.match(/class="sheet-label"/g)||[]).length,10);
  };
  nodes.get('#all-labels-print').onclick();
  assert.equal(prints,1);
  nodes.get('#label-dialog').open = true;
  vm.runInContext('prepareLabelPrinting()',context);
  assert.equal(nodes.get('#selected-labels-pages').dataset.printActive,'false');
  nodes.get('#label-dialog').open = false;
  nodes.get('#qr-labels-view').hidden = true;
  vm.runInContext('prepareLabelPrinting()',context);
  assert.equal(nodes.get('#selected-labels-pages').dataset.printActive,'false');
});

test('dashboard is the default route while spool and archive links keep their destination', async () => {
  const oldUsage = context.loadUsage;
  const oldLink = context.handleSpoolLink;
  const calls = [];
  context.loadUsage = async () => calls.push('statistics');
  context.handleSpoolLink = async () => calls.push('spool');
  try {
    for (const [hash, selected] of [['', 'dashboard'], ['#dashboard', 'dashboard'], ['#archive', 'archive'], ['#spool/permanent-token', 'archive'], ['#cards', 'archive'], ['#usage', 'usage']]) {
      context.window.location.hash = hash;
      await vm.runInContext('switchView()', context);
      assert.equal(nodes.get('#dashboard-view').hidden, selected !== 'dashboard');
      assert.equal(nodes.get('#archive-view').hidden, selected !== 'archive');
      assert.equal(nodes.get('#usage-view').hidden, selected !== 'usage');
    }
    assert.deepEqual(calls, ['statistics', 'statistics', 'spool', 'spool', 'spool', 'statistics']);
  } finally {
    context.loadUsage = oldUsage;
    context.handleSpoolLink = oldLink;
    context.window.location.hash = '#archive';
  }
});

test('QR material heading uses a safe spool color and escapes the material name', () => {
  assert.equal(vm.runInContext("labelMaterial({material:'PLA <Basic>',color_hex:'#50fa7b'})",context), '<strong class="label-material" style="--label-color:#50fa7b">PLA &lt;Basic&gt;</strong>');
  assert.match(vm.runInContext("labelMaterial({material:'PETG',color_hex:'red;display:none'})",context), /--label-color:#282a36/);
});

test('A4 action reveals its adjacent workflow and generates selectable labels', () => {
  const html=fs.readFileSync('static/index.html','utf8');
  const view=html.slice(html.indexOf('<section id="qr-labels-view"'),html.indexOf('<footer>'));
  const gallery=view.slice(view.indexOf('<section id="label-gallery-panel"'),view.indexOf('<section id="a4-labels-section"'));
  const a4=view.slice(view.indexOf('<section id="a4-labels-section"'));
  assert.ok(gallery.includes('id="label-gallery-open"'));
  assert.ok(gallery.includes('id="label-gallery"'));
  assert.ok(!gallery.includes('id="all-labels-open"'));
  assert.ok(a4.indexOf('id="all-labels-open"')<a4.indexOf('id="all-labels-panel"'));
  assert.ok(a4.includes('id="all-labels-pages"'));
  assert.ok(a4.includes('data-i18n-text="0:labels.a4_generate"'));
  assert.ok(!view.slice(0,view.indexOf('<section id="label-gallery-panel"')).includes('<button'));
  context.inventoryState.spools=context.bulkRecords;
  nodes.get('#all-labels-panel').hidden=true;
  let scrolled=0;
  nodes.get('#all-labels-panel').scrollIntoView=()=>{scrolled++;};
  nodes.get('#all-labels-open').onclick();
  assert.equal(nodes.get('#all-labels-panel').hidden,false);
  assert.equal(scrolled,1);
  assert.equal((nodes.get('#all-labels-pages').innerHTML.match(/type="checkbox"/g)||[]).length,10);
  assert.equal(nodes.get('#all-labels-print').disabled,false);
  delete nodes.get('#all-labels-panel').scrollIntoView;
});

test('A4 toggle collapses and reopens without losing checkbox selection', () => {
  context.inventoryState.spools=context.bulkRecords;
  nodes.get('#all-labels-panel').hidden=true;
  nodes.get('#all-labels-open').onclick();
  nodes.get('#all-labels-deselect-all').onclick();
  nodes.get('#all-labels-pages').onchange({target:{closest:()=>({dataset:{labelSpool:'1'},checked:true})}});
  const selected=nodes.get('#selected-labels-pages').innerHTML;
  nodes.get('#all-labels-open').onclick();
  assert.equal(nodes.get('#all-labels-panel').hidden,true);
  assert.equal(nodes.get('#all-labels-open').textContent,'Vis A4-labels');
  assert.equal(nodes.get('#selected-labels-pages').dataset.printActive,'false');
  nodes.get('#all-labels-open').onclick();
  assert.equal(nodes.get('#all-labels-panel').hidden,false);
  assert.equal(nodes.get('#all-labels-open').textContent,'Skjul A4-labels');
  assert.equal(nodes.get('#selected-labels-pages').innerHTML,selected);
});
