const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {loadFrontend} = require('./frontend-loader.cjs');

async function setup() {
  const elements = new Map();
  const calls = [];
  const article = {id:1,title:'<img src=x onerror=alert(1)>',summary:'Kort erfaring',observation:'Set',possible_cause:'Muligt',resolution:'Afkøl',lessons_learned:'Vent',category_id:1,category:'Materialer',confidence:'hypothesis',status:'draft',tags:['PETG'],sources:[{print_id:2,name:'Testprint',print_date:'2026-11-14',materials:['PETG Basic'],note:'Test',relationship_type:'source'}],created_at:'2026-11-14',updated_at:'2026-11-14'};
  const context = vm.createContext({
    location:{hash:''}, URLSearchParams,
    window:{addEventListener(){}},
    $: selector => {
      if (!elements.has(selector)) elements.set(selector,{value:'',dataset:{},innerHTML:'',textContent:'',hidden:false,checked:false,disabled:false,focus(){},reset(){},showModal(){this.open=true;},close(){this.open=false;}});
      return elements.get(selector);
    },
    esc: value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    confirm:()=>true, notify(){}, openPrintEditor:async id=>calls.push(['print',id]),
    request: async (url,options) => {
      calls.push([url,options]);
      if (options) return {ok:true};
      if (url==='/api/knowledge-categories') return [{id:1,name:'Materialer'}];
      if (url==='/api/knowledge-tags') return [{id:1,name:'PETG',article_count:3},{id:2,name:'<PEI>',article_count:1}];
      if (url==='/api/prints') return [{id:2,name:'Testprint',print_date:'2026-11-14'}];
      return url==='/api/knowledge/1' ? article : [article];
    },
  });
  await loadFrontend(context, [], {entry:'knowledge.js',init:false});
  vm.runInContext('initKnowledge()',context);
  return {context,elements,calls,article};
}

test('article detail escapes text and keeps traceable print links', async()=>{
  const {context,elements}=await setup();
  context.location.hash='#knowledge/1';
  await vm.runInContext('showKnowledgeRoute()',context);
  const content=elements.get('#knowledge-detail-content').innerHTML;
  assert.ok(content.includes('&lt;img'));
  assert.ok(!content.includes('<img'));
  assert.ok(content.includes('PETG Basic'));
  assert.ok(content.includes('data-knowledge-print="2"'));
  assert.equal(elements.get('#knowledge-overview').hidden,true);
});

test('overview submits combined search filters', async()=>{
  const {context,calls}=await setup();
  context.$('#knowledge-q').value='PEI';
  context.$('#knowledge-material').value='PETG Basic';
  await vm.runInContext('loadKnowledge()',context);
  const query=calls.find(([url])=>url.startsWith('/api/knowledge?'))[0];
  assert.ok(query.includes('q=PEI'));
  assert.ok(query.includes('material=PETG+Basic'));
});

test('edit preserves source notes and sends explicit verification', async()=>{
  const {context,elements,calls,article}=await setup();
  context.inputArticle=article;
  await vm.runInContext('editKnowledge(inputArticle)',context);
  assert.ok(elements.get('#knowledge-source-list').innerHTML.includes('Test'));
  context.$('#knowledge-edit-confidence').value='verified';
  context.$('#knowledge-confirm-verified').checked=true;
  await elements.get('#knowledge-form').onsubmit({preventDefault(){}});
  const [url,options]=calls.find(([,options])=>options?.method==='PUT');
  assert.equal(url,'/api/knowledge/1');
  const payload=JSON.parse(options.body);
  assert.equal(payload.confirm_verified,true);
  assert.equal(payload.sources[0].print_id,2);
  assert.equal(payload.sources[0].note,'Test');
  assert.equal(elements.get('#knowledge-dialog').open,false);
});

test('removing a source only changes the article proposal', async()=>{
  const {context,elements,calls,article}=await setup();
  context.inputArticle=article;
  await vm.runInContext('editKnowledge(inputArticle)',context);
  elements.get('#knowledge-source-list').onclick({target:{closest:()=>({dataset:{knowledgeRemove:'0'}})}});
  assert.equal(elements.get('#knowledge-source-list').innerHTML,'');
  assert.ok(calls.every(([,options])=>!options));
});

test('AI proposal is editable, starts as draft and needs explicit approval', async()=>{
  const {context,elements,calls,article}=await setup();
  context.proposal={suggestion:{...article,sufficient:true},source:{print_id:2,name:'Testprint',note:'Min erfaring'}};
  await vm.runInContext('editKnowledge(null,proposal)',context);
  assert.equal(elements.get('#knowledge-edit-status').value,'draft');
  assert.equal(elements.get('#knowledge-ai-review').hidden,false);
  assert.equal(elements.get('#knowledge-ai-source-note').textContent,'Min erfaring');
  assert.equal(elements.get('#knowledge-approve-ai').required,true);
  await elements.get('#knowledge-form').onsubmit({preventDefault(){}});
  assert.ok(!calls.some(([,options])=>options?.method==='POST'));
  assert.match(elements.get('#knowledge-form-error').textContent,/godkend/);
  context.$('#knowledge-approve-ai').checked=true;
  context.$('#knowledge-edit-title').value='Min rettede titel';
  context.$('#knowledge-edit-category').value='1';
  await elements.get('#knowledge-form').onsubmit({preventDefault(){}});
  const [,options]=calls.find(([url,options])=>url==='/api/knowledge'&&options);
  const payload=JSON.parse(options.body);
  assert.equal(payload.title,'Min rettede titel');
  assert.equal(payload.origin,'ai_assisted');
  assert.equal(payload.approve_ai,true);
  assert.equal(payload.status,'draft');
  assert.equal(payload.sources[0].print_id,2);
});

test('discarding an AI proposal never saves an article', async()=>{
  const {context,elements,calls,article}=await setup();
  context.proposal={suggestion:article,source:{print_id:2,name:'Testprint',note:'Erfaring'}};
  await vm.runInContext('editKnowledge(null,proposal)',context);
  elements.get('#knowledge-cancel').onclick();
  assert.equal(elements.get('#knowledge-dialog').open,false);
  assert.ok(calls.every(([,options])=>!options));
});

test('insufficient evidence does not open a proposal dialog', async()=>{
  const {context,elements,calls}=await setup();
  context.request=async(url,options)=>{calls.push([url,options]);return {suggestion:{sufficient:false,reason:'For lidt information'}};};
  await vm.runInContext("generateKnowledgeProposal(2,$('#knowledge-ai-generate'),'#knowledge-ai-error')",context);
  assert.equal(elements.get('#knowledge-ai-error').textContent,'For lidt information');
  assert.equal(elements.get('#knowledge-dialog')?.open,undefined);
  assert.equal(elements.get('#knowledge-ai-generate').disabled,false);
  assert.equal(calls.length,1);
});

test('AI failure restores the button and manual creation remains available', async()=>{
  const {context,elements}=await setup();
  const original=context.request;
  context.request=async()=>{throw new Error('OpenAI er ikke konfigureret');};
  await vm.runInContext("generateKnowledgeProposal(2,$('#knowledge-ai-generate'),'#knowledge-ai-error')",context);
  assert.match(elements.get('#knowledge-ai-error').textContent,/ikke konfigureret/);
  assert.equal(elements.get('#knowledge-ai-generate').disabled,false);
  context.request=original;
  await vm.runInContext('editKnowledge()',context);
  assert.equal(elements.get('#knowledge-dialog').open,true);
  assert.equal(elements.get('#knowledge-ai-review').hidden,true);
  assert.equal(elements.get('#knowledge-approve-ai').required,false);
});

test('unsaved print notes prevent analysis of stale saved data', async()=>{
  const {context,elements,calls}=await setup();
  context.$('#print-knowledge-generate').dataset={printId:'2',note:'Gemt note',name:'Print',status:'completed'};
  context.$('#print-note').value='Ny ugemt erfaring';
  await elements.get('#print-knowledge-generate').onclick();
  assert.match(elements.get('#print-error').textContent,/Gem ændringerne/);
  assert.equal(calls.length,0);
});

test('category overview shows global counts and filters without losing other criteria', async()=>{
  const {context,elements,calls}=await setup();
  vm.runInContext(`knowledgeCategories=[{id:1,name:'<Materialer>',article_count:5},{id:2,name:'Vedligeholdelse',article_count:0}]; renderKnowledgeCategories();`,context);
  const list=elements.get('#knowledge-category-list').innerHTML;
  assert.ok(list.includes('&lt;Materialer&gt;'));
  assert.ok(!list.includes('<Materialer>'));
  assert.ok(list.includes('5 artikler'));
  assert.ok(list.includes('0 artikler'));
  context.$('#knowledge-q').value='PEI';
  await elements.get('#knowledge-category-list').onclick({target:{closest:()=>({dataset:{knowledgeCategory:'1'}})}});
  assert.equal(context.$('#knowledge-category_id').value,'1');
  assert.ok(calls.some(([url])=>url.includes('q=PEI')&&url.includes('category_id=1')));
  await elements.get('#knowledge-category-list').onclick({target:{closest:()=>({dataset:{knowledgeCategory:''}})}});
  assert.equal(context.$('#knowledge-q').value,'PEI');
  assert.ok(!calls.at(-1)[0].includes('category_id'));
});

test('tag autocomplete loads all used tags and escapes option values', async()=>{
  const {context,elements,calls}=await setup();
  context.location.hash='#knowledge';
  await vm.runInContext('showKnowledgeRoute()',context);
  assert.ok(calls.some(([url])=>url==='/api/knowledge-tags'));
  const options=elements.get('#knowledge-tag-options').innerHTML;
  assert.ok(options.includes('value="PETG" label="3 artikler"'));
  assert.ok(options.includes('value="&lt;PEI&gt;" label="1 artikel"'));
  assert.ok(!options.includes('value="<PEI>"'));
});

test('tags are escaped badges and clicking one combines with other filters', async()=>{
  const {context,elements,calls,article}=await setup();
  article.tags=['PETG','<script>'];
  await vm.runInContext('loadKnowledge()',context);
  const cards=elements.get('#knowledge-results').innerHTML;
  assert.ok(cards.includes('class="knowledge-tag'));
  assert.ok(cards.includes('data-knowledge-tag="PETG"'));
  assert.ok(cards.includes('&lt;script&gt;'));
  assert.ok(!cards.includes('<script>'));
  context.$('#knowledge-category_id').value='1';
  await elements.get('#knowledge-results').onclick({target:{closest:()=>({dataset:{knowledgeTag:'PETG'}})}});
  assert.equal(context.$('#knowledge-tag').value,'PETG');
  const query=calls.at(-1)[0];
  assert.ok(query.includes('tag=PETG'));
  assert.ok(query.includes('category_id=1'));
  context.$('#knowledge-tag').value='<PEI>';
  await elements.get('#knowledge-tag').onchange();
  assert.ok(calls.at(-1)[0].includes('tag=%3CPEI%3E'));
});

test('article statuses have explicit labels and distinct badges on overview cards', async()=>{
  const {context,elements,article}=await setup();
  for (const [status,label] of Object.entries({draft:'Kladde',published:'Publiceret',archived:'Arkiveret'})) {
    article.status=status;
    await vm.runInContext('loadKnowledge()',context);
    const html=elements.get('#knowledge-results').innerHTML;
    assert.ok(html.includes(`knowledge-status-${status}`));
    assert.ok(html.includes(`aria-label="Artikelstatus: ${label}"`));
    assert.ok(html.includes('knowledge-card-heading'));
  }
});

test('category rename uses the shared form and sends PUT, cancel returns to create', async()=>{
  const {context,elements,calls}=await setup();
  context.location.hash='#knowledge';
  await vm.runInContext('showKnowledgeRoute()',context);
  await elements.get('#knowledge-category-admin-list').onclick({target:{closest:selector=>selector==='[data-knowledge-category-edit]'?{dataset:{knowledgeCategoryEdit:'1'}}:null}});
  assert.equal(elements.get('#knowledge-category-name').value,'Materialer');
  assert.equal(elements.get('#knowledge-category-add').textContent,'Gem navn');
  context.$('#knowledge-category-name').value='Nyt navn';
  await elements.get('#knowledge-category-form').onsubmit({preventDefault(){}});
  const [,options]=calls.find(([url,options])=>url==='/api/knowledge-categories/1'&&options);
  assert.equal(options.method,'PUT');
  assert.equal(JSON.parse(options.body).name,'Nyt navn');
  assert.equal(elements.get('#knowledge-category-add').textContent,'Opret kategori');
  elements.get('#knowledge-category-cancel').onclick();
  assert.equal(elements.get('#knowledge-category-cancel').hidden,true);
});

test('deleting an empty category clears only its selected filter', async()=>{
  const {context,elements,calls}=await setup();
  context.location.hash='#knowledge';
  await vm.runInContext('showKnowledgeRoute()',context);
  context.$('#knowledge-category_id').value='1';
  context.$('#knowledge-tag').value='PETG';
  await elements.get('#knowledge-category-admin-list').onclick({target:{closest:selector=>selector==='[data-knowledge-category-delete]'?{dataset:{knowledgeCategoryDelete:'1'}}:null}});
  assert.ok(calls.some(([url,options])=>url==='/api/knowledge-categories/1'&&options?.method==='DELETE'));
  assert.equal(context.$('#knowledge-category_id').value,'');
  assert.equal(context.$('#knowledge-tag').value,'PETG');
});

test('saving an edited article reloads its detail even when fields no longer match filters', async()=>{
  const {context,elements,calls,article}=await setup();
  context.location.hash='#knowledge/1';
  const original=context.request;
  context.request=async(url,options)=>{
    if(url==='/api/knowledge/1'&&options?.method==='PUT') {
      const payload=JSON.parse(options.body);
      payload.sources=payload.sources.map(source=>({...article.sources.find(existing=>existing.print_id===source.print_id),...source}));
      Object.assign(article,payload);
    }
    return original(url,options);
  };
  await vm.runInContext('showKnowledgeRoute()',context);
  await elements.get('#knowledge-edit').onclick();
  context.$('#knowledge-status').value='draft';
  context.$('#knowledge-edit-status').value='published';
  context.$('#knowledge-edit-title').value='Opdateret artikel';
  await elements.get('#knowledge-form').onsubmit({preventDefault(){}});
  const detail=elements.get('#knowledge-detail-content').innerHTML;
  assert.ok(detail.includes('Opdateret artikel'));
  assert.ok(detail.includes('knowledge-status-published'));
  assert.equal(context.location.hash,'#knowledge/1');
  assert.equal(elements.get('#knowledge-detail').hidden,false);
  assert.equal(elements.get('#knowledge-overview').hidden,true);
  const saveIndex=calls.findIndex(([,options])=>options?.method==='PUT');
  assert.ok(calls.slice(saveIndex+1).some(([url,options])=>url==='/api/knowledge/1'&&!options));
});

test('the form keeps its article identity when the viewed article changes', async()=>{
  const {context,elements,calls,article}=await setup();
  context.inputArticle=article;
  await vm.runInContext('editKnowledge(inputArticle)',context);
  vm.runInContext('knowledgeCurrent={...inputArticle,id:2}',context);
  await elements.get('#knowledge-form').onsubmit({preventDefault(){}});
  const [url]=calls.find(([,options])=>options?.method==='PUT');
  assert.equal(url,'/api/knowledge/1');
  assert.equal(context.location.hash,'#knowledge/1');
});

test('an older detail response cannot replace a more recently selected article', async()=>{
  const {context,elements,article}=await setup();
  const original=context.request;
  let finishOld;
  context.request=async(url,options)=>{
    if(url==='/api/knowledge/1'&&!options) return new Promise(resolve=>{finishOld=resolve;});
    if(url==='/api/knowledge/2') return {...article,id:2,title:'Nyeste artikel'};
    return original(url,options);
  };
  context.location.hash='#knowledge/1';
  const first=vm.runInContext('showKnowledgeRoute()',context);
  await new Promise(resolve=>setImmediate(resolve));
  context.location.hash='#knowledge/2';
  await vm.runInContext('showKnowledgeRoute()',context);
  finishOld(article);
  await first;
  assert.ok(elements.get('#knowledge-detail-content').innerHTML.includes('Nyeste artikel'));
  assert.equal(vm.runInContext('knowledgeCurrent.id',context),2);
});

test('an older filtered list response cannot replace newer search results', async()=>{
  const {context,elements,article}=await setup();
  let finishOld;
  context.request=async url=>url.includes('q=old')?new Promise(resolve=>{finishOld=resolve;}):[{...article,title:'Nyt søgeresultat'}];
  context.$('#knowledge-q').value='old';
  const first=vm.runInContext('loadKnowledge()',context);
  context.$('#knowledge-q').value='new';
  await vm.runInContext('loadKnowledge()',context);
  finishOld([{...article,title:'Gammelt søgeresultat'}]);
  await first;
  const list=elements.get('#knowledge-results').innerHTML;
  assert.ok(list.includes('Nyt søgeresultat'));
  assert.ok(!list.includes('Gammelt søgeresultat'));
});

test('article presentation separates summary, evidence and source content without unescaped markup', async()=>{
  const {context,article}=await setup();
  context.inputArticle={...article,possible_cause:'<script>cause</script>',sources:[{...article.sources[0],note:'<img src=x onerror=alert(1)>'}]};
  const html=vm.runInContext('renderKnowledgeArticle(inputArticle)',context);
  assert.ok(html.includes('experience-hero'));
  assert.ok(html.includes('experience-lead'));
  assert.ok(html.includes('Grundlag for erfaringen'));
  assert.ok(html.includes('En mulig forklaring, der endnu ikke er verificeret.'));
  assert.ok(html.includes('data-knowledge-print="2"'));
  assert.ok(html.includes('datetime="2026-11-14"'));
  assert.ok(html.includes('&lt;script&gt;cause&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
});

test('article presentation handles missing optional content and zero sources honestly', async()=>{
  const {context,article}=await setup();
  context.inputArticle={...article,summary:'',observation:'',possible_cause:'',resolution:'',lessons_learned:'',sources:[],tags:[],created_at:'',updated_at:'',confidence:'observation'};
  const html=vm.runInContext('renderKnowledgeArticle(inputArticle)',context);
  assert.ok(html.includes('Ingen printkilder endnu.'));
  assert.ok(html.includes('Tilknyt et print via Redigér artikel.'));
  assert.ok(html.includes('Ikke angivet'));
  assert.ok(!html.includes('undefined'));
  assert.ok(!html.includes('Invalid Date'));
  assert.ok(!html.includes('experience-lead'));
});

test('article deletion requires confirmation and returns to overview after success', async()=>{
  const {context,elements,calls}=await setup();
  context.location.hash='#knowledge/1';
  await vm.runInContext('showKnowledgeRoute()',context);
  context.confirm=()=>false;
  await elements.get('#knowledge-delete').onclick();
  assert.ok(!calls.some(([,options])=>options?.method==='DELETE'));
  context.confirm=()=>true;
  await elements.get('#knowledge-delete').onclick();
  assert.ok(calls.some(([url,options])=>url==='/api/knowledge/1'&&options?.method==='DELETE'));
  assert.equal(context.location.hash,'#knowledge');
  assert.equal(vm.runInContext('knowledgeCurrent',context),null);
  assert.equal(elements.get('#knowledge-detail-content').innerHTML,'');
});

test('failed article deletion keeps the article visible and allows retry', async()=>{
  const {context,elements}=await setup();
  context.location.hash='#knowledge/1';
  await vm.runInContext('showKnowledgeRoute()',context);
  const before=elements.get('#knowledge-detail-content').innerHTML;
  const original=context.request;
  context.request=async(url,options)=>{
    if(options?.method==='DELETE') throw new Error('Kunne ikke slette artiklen');
    return original(url,options);
  };
  await elements.get('#knowledge-delete').onclick();
  assert.equal(context.location.hash,'#knowledge/1');
  assert.equal(elements.get('#knowledge-detail-content').innerHTML,before);
  assert.equal(elements.get('#knowledge-delete').disabled,false);
  assert.equal(elements.get('#knowledge-edit').disabled,false);
  assert.match(elements.get('#knowledge-error').textContent,/Kunne ikke slette/);
});

test('finishing a deletion does not replace another article opened meanwhile', async()=>{
  const {context,elements,article}=await setup();
  context.location.hash='#knowledge/1';
  await vm.runInContext('showKnowledgeRoute()',context);
  const original=context.request;
  let finishDelete;
  context.request=async(url,options)=>{
    if(options?.method==='DELETE') return new Promise(resolve=>{finishDelete=resolve;});
    if(url==='/api/knowledge/2') return {...article,id:2,title:'En anden artikel'};
    return original(url,options);
  };
  const deleting=elements.get('#knowledge-delete').onclick();
  context.location.hash='#knowledge/2';
  await vm.runInContext('showKnowledgeRoute()',context);
  finishDelete({ok:true});
  await deleting;
  assert.equal(context.location.hash,'#knowledge/2');
  assert.ok(elements.get('#knowledge-detail-content').innerHTML.includes('En anden artikel'));
});

test('Administration category edits refresh shared metadata without loading articles or prints',async()=>{
  const {context,elements,calls}=await setup();
  context.location.hash='#admin/categories';
  let categories=[{id:1,name:'Materialer',article_count:1},{id:2,name:'Tom',article_count:0}];
  context.request=async(url,options)=>{
    calls.push([url,options]);
    if(!options)return categories;
    if(options.method==='PUT')categories=categories.map(c=>c.id===1?{...c,name:JSON.parse(options.body).name}:c);
    if(options.method==='DELETE')categories=categories.filter(c=>c.id!==2);
    return {ok:true};
  };
  await vm.runInContext('loadKnowledgeCategories()',context);
  assert.ok(!elements.get('#knowledge-category-list').innerHTML.includes('data-knowledge-category-edit'));
  assert.ok(elements.get('#knowledge-category-admin-list').innerHTML.includes('data-knowledge-category-edit'));
  context.$('#knowledge-category_id').value='1';
  context.$('#knowledge-tag').value='PETG';
  await elements.get('#knowledge-category-admin-list').onclick({target:{closest:selector=>selector==='[data-knowledge-category-edit]'?{dataset:{knowledgeCategoryEdit:'1'}}:null}});
  context.$('#knowledge-category-name').value='Nyt navn';
  await elements.get('#knowledge-category-form').onsubmit({preventDefault(){}});
  assert.match(elements.get('#knowledge-category-admin-list').innerHTML,/Nyt navn/);
  assert.match(elements.get('#knowledge-category_id').innerHTML,/Nyt navn/);
  assert.equal(context.$('#knowledge-category_id').value,'1');
  await elements.get('#knowledge-category-admin-list').onclick({target:{closest:selector=>selector==='[data-knowledge-category-delete]'?{dataset:{knowledgeCategoryDelete:'2'}}:null}});
  assert.ok(!elements.get('#knowledge-category-admin-list').innerHTML.includes('>Tom<'));
  assert.equal(context.$('#knowledge-category_id').value,'1');
  assert.equal(context.$('#knowledge-tag').value,'PETG');
  assert.ok(calls.every(([url])=>url.startsWith('/api/knowledge-categories')));
});

test('category mutation errors are shown in Administration and leave the form editable',async()=>{
  const {context,elements}=await setup();
  context.location.hash='#admin/categories';
  context.request=async()=>{throw new Error('Name already exists');};
  context.$('#knowledge-category-name').value='Duplicate';
  await elements.get('#knowledge-category-form').onsubmit({preventDefault(){}});
  assert.equal(elements.get('#knowledge-category-error').textContent,'Name already exists');
  assert.equal(elements.get('#knowledge-category-add').disabled,false);
  assert.equal(context.$('#knowledge-category-name').value,'Duplicate');
});
