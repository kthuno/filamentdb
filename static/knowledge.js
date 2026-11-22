import { t, th, getLocale } from './i18n.js';
import { $, esc, notify, request } from './core.js';
import { PrintEditor } from './prints.js';
/* Knowledge stays independent of inventory mutations. */
let knowledgeCategories = [], knowledgePrints = [], knowledgeCurrent = null;
const knowledgeLabels = {get observation() { return t("ui.observation_d239e9"); },get hypothesis() { return t("ui.hypotese_95885d"); },get verified() { return t("ui.verificeret_fund_ce19ed"); },get draft() { return t("ui.kladde_0d4afa"); },get published() { return t("ui.publiceret_c630f6"); },get archived() { return t("ui.arkiveret_e47d8a"); }};
const knowledgeFields = {get title() { return t("ui.titel_abcafc"); },get summary() { return t("ui.resume_a6ab7e"); },get observation() { return t("ui.observation_d239e9"); },get possible_cause() { return t("ui.mulig_aarsag_668696"); },get resolution() { return t("ui.loesning_50fc80"); },get lessons_learned() { return t("ui.laering_97adbc"); }};
let knowledgeSources = [];
let knowledgeTags = [];
let editingKnowledgeCategoryId = null;
let knowledgeProposal = null;
let knowledgeEditingId = null;
let knowledgeRouteVersion = 0;
let knowledgeListVersion = 0;
function knowledgeStatusBadge(status) {
  const labels = {draft:t("ui.kladde_0d4afa"),published:t("ui.publiceret_c630f6"),archived:t("ui.arkiveret_e47d8a")};
  const safeStatus = Object.hasOwn(labels,status) ? status : 'draft';
  return `<span class="knowledge-status knowledge-status-${safeStatus}" aria-label="${th("ui.artikelstatus_36dba2", {p1: esc(labels[safeStatus])})}"><span aria-hidden="true"></span>${esc(labels[safeStatus])}</span>`;
}
function knowledgeRoute() { return location.hash === '#knowledge' || location.hash.startsWith('#knowledge/'); }
function renderKnowledgeCategories() {
  const selected = $('#knowledge-category_id').value;
  const total = knowledgeCategories.reduce((sum, category) => sum + Number(category.article_count || 0), 0);
  const categoryButton = (id, name, count) => `<button type="button" class="knowledge-category-tile ${String(id) === selected ? 'selected' : ''}" data-knowledge-category="${id}" aria-pressed="${String(id) === selected}"><span>${esc(name)}</span><small>${count} ${count === 1 ? 'artikel' : 'artikler'}</small></button>`;
  $('#knowledge-category-list').innerHTML = categoryButton('', t("ui.alle_kategorier_9ccf80"), total) + knowledgeCategories.map(category => `<div class="knowledge-category-item">${categoryButton(category.id, category.name, Number(category.article_count || 0))}<div class="knowledge-category-actions"><button type="button" data-knowledge-category-edit="${category.id}" aria-label="${th("ui.omdoeb_kategori_b5ff6b", {p2: esc(category.name)})}">${th("ui.omdoeb_f917d1")}</button><button type="button" data-knowledge-category-delete="${category.id}" aria-label="${th("ui.slet_kategori_58198c", {p4: esc(category.name)})}" ${Number(category.article_count || 0) > 0 ? th("ui.disabled_title_flyt_artiklerne_til_en_anden_kate_3fb377") : ''}>${th("ui.slet_b9f4c0")}</button></div></div>`).join('');
}
function renderKnowledgeTagOptions() {
  $('#knowledge-tag-options').innerHTML = knowledgeTags.map(tag => `<option value="${esc(tag.name)}" label="${tag.article_count} ${tag.article_count === 1 ? 'artikel' : 'artikler'}"></option>`).join('');
}
function knowledgeTagBadges(tags, clickable=false) {
  if (!tags.length) return '';
  const selected = $('#knowledge-tag').value.trim().toLocaleLowerCase('da');
  return `<div class="knowledge-tags" aria-label="${th("ui.tags_133127")}">${tags.map(tag => clickable
    ? `<button type="button" class="knowledge-tag ${tag.toLocaleLowerCase('da') === selected ? 'selected' : ''}" data-knowledge-tag="${esc(tag)}" aria-pressed="${tag.toLocaleLowerCase('da') === selected}" title="${th("ui.filtrer_paa_tag_8f535f", {p3: esc(tag)})}">${esc(tag)}</button>`
    : `<span class="knowledge-tag">${esc(tag)}</span>`).join('')}</div>`;
}
async function loadKnowledge() {
  const version = ++knowledgeListVersion, hash = location.hash;
  const error = $('#knowledge-error'); error.textContent = '';
  try {
    const params = new URLSearchParams();
    for (const key of ['q','category_id','confidence','status','tag','material']) {
      const value = $(`#knowledge-${key}`).value.trim(); if (value) params.set(key,value);
    }
    const records = await request('/api/knowledge?' + params);
    if (version !== knowledgeListVersion || hash !== location.hash) return;
    renderKnowledgeCategories();
    $('#knowledge-results').innerHTML = records.map(article => `<article class="knowledge-card"><div class="knowledge-card-heading"><h2><a href="#knowledge/${article.id}">${esc(article.title)}</a></h2>${knowledgeStatusBadge(article.status)}</div><p>${esc(article.summary)}</p><p class="knowledge-meta">${esc(article.category)} · ${esc(knowledgeLabels[article.confidence])}</p>${knowledgeTagBadges(article.tags,true)}<small>${th("ui.printkilder_3c02fd", {p7: article.sources.length})}</small></article>`).join('') || `<p>${th("ui.ingen_artikler_matcher_opret_en_artikel_eller_ju_30e6cc")}</p>`;
  } catch (err) { if (version === knowledgeListVersion && hash === location.hash) error.textContent = err.message; }
}
async function showKnowledgeRoute() {
  const version = ++knowledgeRouteVersion, hash = location.hash;
  ++knowledgeListVersion;
  if (!knowledgeRoute()) return;
  $('#knowledge-error').textContent = '';
  $('#knowledge-edit').disabled = true;
  $('#knowledge-delete').disabled = true;
  try {
    const metadata = await Promise.all([request('/api/knowledge-categories'),request('/api/prints'),request('/api/knowledge-tags')]);
    if (version !== knowledgeRouteVersion || hash !== location.hash) return;
    [knowledgeCategories,knowledgePrints,knowledgeTags] = metadata;
    renderKnowledgeTagOptions();
    $('#knowledge-ai-print').innerHTML = `<option value="">${th("ui.vaelg_print_0d29ab")}</option>` + knowledgePrints.filter(p => ['completed','failed'].includes(p.status)).map(p => `<option value="${p.id}">${esc(p.name)} · ${esc(p.print_date)}</option>`).join('');
    const filter = $('#knowledge-category_id'), selected = filter.value;
    filter.innerHTML = `<option value="">${th("ui.alle_kategorier_9ccf80")}</option>` + knowledgeCategories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join(''); filter.value = selected;
    renderKnowledgeCategories();
    const match = hash.match(/^#knowledge\/(\d+)$/);
    $('#knowledge-detail').hidden = !match;
    $('#knowledge-overview').hidden = !!match;
    if (!match) return loadKnowledge();
    const a = await request('/api/knowledge/'+match[1]);
    if (version !== knowledgeRouteVersion || hash !== location.hash) return;
    knowledgeCurrent = a;
    $('#knowledge-edit').disabled = false;
    $('#knowledge-delete').disabled = false;
    $('#knowledge-detail-content').innerHTML = renderKnowledgeArticle(a);
  } catch(err) { if (version === knowledgeRouteVersion && hash === location.hash) $('#knowledge-error').textContent = err.message; }
}
function knowledgeArticleDate(value) {
  if (!value) return t("ui.ikke_angivet_898bb9");
  const date = new Date(value.length === 10 ? value+'T12:00:00' : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(getLocale(),{day:'numeric',month:'short',year:'numeric'}).format(date);
}
function renderKnowledgeArticle(article) {
  const evidence = {
    observation:{label:t("ui.observation_d239e9"),symbol:'◉',description:t("ui.en_konkret_erfaring_eller_et_resultat_der_er_obs_511045")},
    hypothesis:{label:t("ui.hypotese_95885d"),symbol:'?',description:t("ui.en_mulig_forklaring_der_endnu_ikke_er_verificere_d4c4aa")},
    verified:{label:t("ui.verificeret_fund_ce19ed"),symbol:'✓',description:t("ui.understoettet_af_test_eller_gentagne_erfaringer_2f1843")}
  };
  const classification = evidence[article.confidence] || evidence.observation;
  const sections = [
    {field:'observation',title:t("ui.observation_d239e9"),symbol:'◉',caption:t("ui.det_der_blev_observeret_384544")},
    {field:'possible_cause',title:t("ui.mulig_aarsag_668696"),symbol:'?',caption:t("ui.en_mulig_forklaring_986069")},
    {field:'resolution',title:t("ui.loesning_50fc80"),symbol:'✓',caption:t("ui.det_der_kan_goeres_e89f6c")},
    {field:'lessons_learned',title:t("ui.laering_97adbc"),symbol:'↗',caption:t("ui.tag_med_til_naeste_print_8f096d")}
  ];
  const origin = article.origin === 'ai_assisted' ? t("ui.ai_assisteret_artikel_8f4f15") : t("ui.manuelt_oprettet_artikel_fed8ef");
  const sources = article.sources.map(source => `<article class="experience-source"><span class="experience-source-type">${{source:th("ui.printkilde_366662"),test:th("ui.test_532eaa"),confirmation:th("ui.bekraeftelse_1061ed")}[source.relationship_type] || th("ui.printkilde_366662")}</span><button type="button" data-knowledge-print="${esc(source.print_id)}">${esc(source.name)} <span aria-hidden="true">↗</span></button><time datetime="${esc(source.print_date)}">${esc(knowledgeArticleDate(source.print_date))}</time>${source.materials.length ? `<div class="experience-materials">${source.materials.map(material => `<span>${esc(material)}</span>`).join('')}</div>` : ''}${source.note ? `<p class="knowledge-prose">${esc(source.note)}</p>` : ''}</article>`).join('');
  return `<article class="experience-article"><header class="experience-hero"><div class="experience-hero-top"><span class="experience-category">${esc(article.category)}</span>${knowledgeStatusBadge(article.status)}</div><h1>${esc(article.title)}</h1>${article.summary ? `<p class="experience-lead knowledge-prose">${esc(article.summary)}</p>` : ''}${knowledgeTagBadges(article.tags)}<div class="experience-hero-meta"><span>${article.sources.length} ${article.sources.length === 1 ? 'printkilde' : 'printkilder'}</span><span>${th("ui.opdateret_177bbe", {p7: esc(knowledgeArticleDate(article.updated_at))})}</span></div></header><div class="experience-layout"><div class="experience-body">${sections.map(section => `<section class="experience-section experience-section-${section.field}"><div class="experience-section-heading"><span class="experience-section-icon" aria-hidden="true">${section.symbol}</span><div><span class="experience-caption">${section.caption}</span><h2>${section.title}</h2></div></div><p class="knowledge-prose ${article[section.field] ? '' : 'experience-empty'}">${esc(article[section.field]) || th("ui.ikke_angivet_898bb9")}</p></section>`).join('')}</div><aside class="experience-sidebar" aria-label="${th("ui.grundlag_og_printkilder_2b3902")}"><section class="experience-evidence"><span class="experience-caption">${th("ui.grundlag_for_erfaringen_8363c0")}</span><div class="experience-evidence-title"><span aria-hidden="true">${classification.symbol}</span><h2>${classification.label}</h2></div><p>${classification.description}</p></section><section class="experience-sources"><div class="experience-sidebar-heading"><h2>${th("ui.printkilder_170dd9")}</h2><span>${article.sources.length}</span></div>${sources || `<div class="experience-source-empty"><span aria-hidden="true">▧</span><p>${th("ui.ingen_printkilder_endnu_61f9e0")}</p><small>${th("ui.tilknyt_et_print_via_rediger_artikel_cdf447")}</small></div>`}</section><section class="experience-information"><span class="experience-caption">${th("ui.om_artiklen_ecdc76")}</span><dl><div><dt>${th("ui.oprettet_2d9cc6")}</dt><dd><time datetime="${esc(article.created_at)}">${esc(knowledgeArticleDate(article.created_at))}</time></dd></div><div><dt>${th("ui.opdateret_4bc229")}</dt><dd><time datetime="${esc(article.updated_at)}">${esc(knowledgeArticleDate(article.updated_at))}</time></dd></div><div><dt>${th("ui.oprindelse_d605e7")}</dt><dd>${origin}</dd></div></dl></section></aside></div></article>`;
}
function renderKnowledgeSources() {
  $('#knowledge-source-list').innerHTML = knowledgeSources.map((source,index) => `<div class="knowledge-source"><strong>${esc(knowledgePrints.find(p => p.id === source.print_id)?.name || t("ui.print_74a010")+source.print_id)}</strong><label>${th("ui.forklaring_bc836b")}<textarea maxlength="2000" data-knowledge-note="${index}">${esc(source.note)}</textarea></label><label>${th("ui.relation_136748")}<select data-knowledge-relation="${index}">${Object.entries({source:th("ui.kilde_2ce919"),test:th("ui.test_532eaa"),confirmation:th("ui.bekraeftelse_1061ed")}).map(([value,label]) => `<option value="${value}" ${value===source.relationship_type?'selected':''}>${label}</option>`).join('')}</select></label><button type="button" data-knowledge-remove="${index}">${th("ui.fjern_kilde_71eb83")}</button></div>`).join('');
}
async function editKnowledge(article=null, proposal=null) {
  try {
    [knowledgeCategories,knowledgePrints] = await Promise.all([request('/api/knowledge-categories'),request('/api/prints')]);
    knowledgeEditingId = article?.id ?? null;
    knowledgeProposal = proposal;
    const fields = proposal ? {...proposal.suggestion, status:'draft', sources:[{print_id:proposal.source.print_id,note:'',relationship_type:'source'}]} : article;
    $('#knowledge-form').reset(); $('#knowledge-form-error').textContent = '';
    $('#knowledge-dialog-title').textContent = proposal ? t("ui.gennemgaa_vidensforslag_c21e96") : article ? t("ui.rediger_artikel_383cb4") : t("ui.ny_artikel_8f47d4");
    $('#knowledge-ai-review').hidden = !proposal;
    $('#knowledge-approve-ai').checked = false;
    $('#knowledge-approve-ai').required = !!proposal;
    $('#knowledge-save').textContent = proposal ? t("ui.godkend_og_gem_artikel_7423a4") : t("ui.gem_artikel_ba04ad");
    $('#knowledge-cancel').textContent = proposal ? t("ui.forkast_forslag_5d0823") : t("ui.annuller_e5bb5e");
    if (proposal) {
      $('#knowledge-ai-explanation').textContent = t("ui.indhold_kategori_tags_og_evidensklasse_er_foresl_e89620", {p0: proposal.source.name});
      $('#knowledge-ai-source-note').textContent = proposal.source.note;
    }
    for (const field of Object.keys(knowledgeFields)) $(`#knowledge-edit-${field}`).value = fields?.[field] || '';
    $('#knowledge-edit-category').innerHTML = knowledgeCategories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if (fields) $('#knowledge-edit-category').value = fields.category_id;
    $('#knowledge-edit-confidence').value = fields?.confidence || 'observation';
    $('#knowledge-edit-status').value = fields?.status || 'draft';
    $('#knowledge-edit-tags').value = fields?.tags.join(', ') || '';
    knowledgeSources = (fields?.sources || []).map(s => ({print_id:s.print_id,note:s.note,relationship_type:s.relationship_type}));
    $('#knowledge-source-select').innerHTML = knowledgePrints.map(p => `<option value="${p.id}">${esc(p.name)} · ${esc(p.print_date)}</option>`).join('');
    renderKnowledgeSources(); $('#knowledge-dialog').showModal();
  } catch(err) { if (proposal) throw err; $('#knowledge-error').textContent = err.message; }
}
function resetKnowledgeCategoryForm() {
  editingKnowledgeCategoryId = null;
  $('#knowledge-category-name').value = '';
  $('#knowledge-category-add').textContent = t("ui.opret_kategori_a911e2");
  $('#knowledge-category-cancel').hidden = true;
}
async function generateKnowledgeProposal(id, button, errorSelector) {
  const error = $(errorSelector); error.textContent='';
  if (!Number.isInteger(id) || id < 1) { error.textContent=t("ui.vaelg_et_print_foerst_e39473"); return; }
  const label = button.textContent; button.disabled=true; button.textContent=t("ui.analyserer_printnote_75368f");
  try {
    const proposal = await request(`/api/prints/${id}/knowledge-suggestion`, {method:'POST'});
    if (!proposal.suggestion.sufficient) { error.textContent=proposal.suggestion.reason; return; }
    await editKnowledge(null, proposal);
    if (proposal.cached) notify(t("ui.viser_et_tidligere_forslag_til_de_samme_gemte_no_6c7734"));
  } catch(err) { error.textContent=err.message; }
  finally { button.disabled=false; button.textContent=label; }
}

function initKnowledge() {
  $('#knowledge-new').onclick = () => editKnowledge();
  $('#knowledge-edit').onclick = () => editKnowledge(knowledgeCurrent);
  $('#knowledge-delete').onclick = async () => {
    const article = knowledgeCurrent;
    if (!article || location.hash !== '#knowledge/'+article.id) return;
    if (!confirm(t("ui.slet_artiklen_permanent_print_spoler_og_forbrugs_1a20f7", {p0: article.title}))) return;
    const hash = location.hash;
    const button = $('#knowledge-delete'); button.disabled = true;
    $('#knowledge-edit').disabled = true;
    $('#knowledge-error').textContent = '';
    try {
      await request('/api/knowledge/'+article.id, {method:'DELETE'});
      if (location.hash === hash) {
        // Invalidate outstanding responses before leaving the deleted article.
        ++knowledgeRouteVersion; ++knowledgeListVersion;
        knowledgeCurrent = null;
        $('#knowledge-detail-content').innerHTML = '';
        location.hash = '#knowledge';
      } else if (location.hash === '#knowledge') {
        await showKnowledgeRoute();
      }
      notify(t("ui.artiklen_er_slettet_261456"));
    } catch(error) {
      if (location.hash === hash) {
        $('#knowledge-error').textContent = error.message;
        button.disabled = false;
        $('#knowledge-edit').disabled = false;
      } else { notify(error.message); }
    }
  };
  $('#knowledge-close').onclick = $('#knowledge-cancel').onclick = () => $('#knowledge-dialog').close();
  $('#knowledge-source-add').onclick = () => {
    const id = Number($('#knowledge-source-select').value);
    if (knowledgePrints.some(p => p.id===id) && !knowledgeSources.some(s => s.print_id===id)) { knowledgeSources.push({print_id:id,note:'',relationship_type:'source'}); renderKnowledgeSources(); }
  };
  $('#knowledge-source-list').oninput = event => { if (event.target.dataset.knowledgeNote !== undefined) knowledgeSources[Number(event.target.dataset.knowledgeNote)].note = event.target.value; };
  $('#knowledge-source-list').onchange = event => { if (event.target.dataset.knowledgeRelation !== undefined) knowledgeSources[Number(event.target.dataset.knowledgeRelation)].relationship_type = event.target.value; };
  $('#knowledge-source-list').onclick = event => { const button=event.target.closest('[data-knowledge-remove]'); if(button) { knowledgeSources.splice(Number(button.dataset.knowledgeRemove),1); renderKnowledgeSources(); } };
  $('#knowledge-detail-content').onclick = async event => {
    const button=event.target.closest('[data-knowledge-print]'); if (!button) return;
    try { await PrintEditor.open(Number(button.dataset.knowledgePrint)); } catch(err) { $('#knowledge-error').textContent=err.message; }
  };
  $('#knowledge-form').onsubmit = async event => {
    event.preventDefault(); $('#knowledge-form-error').textContent=''; $('#knowledge-save').disabled=true;
    try {
      const payload=Object.fromEntries(Object.keys(knowledgeFields).map(field => [field,$(`#knowledge-edit-${field}`).value]));
      Object.assign(payload,{category_id:Number($('#knowledge-edit-category').value),confidence:$('#knowledge-edit-confidence').value,status:$('#knowledge-edit-status').value,tags:$('#knowledge-edit-tags').value.split(',').map(t=>t.trim()).filter(Boolean),sources:knowledgeSources,confirm_verified:$('#knowledge-confirm-verified').checked});
      if (knowledgeProposal) {
        if (!$('#knowledge-approve-ai').checked) throw new Error(t("ui.gennemgaa_og_godkend_ai_forslaget_foer_du_gemmer_eafc90"));
        payload.origin = 'ai_assisted'; payload.approve_ai = true;
      }
      const savedId = knowledgeEditingId;
      await request('/api/knowledge'+(savedId !== null ? '/'+savedId : ''),{method:savedId !== null?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      $('#knowledge-dialog').close();
      if (savedId !== null && location.hash !== '#knowledge/'+savedId) {
        // Keep the saved article visible even if its new fields no longer match filters.
        location.hash = '#knowledge/'+savedId;
      } else {
        await showKnowledgeRoute();
      }
      notify(t("ui.artiklen_er_gemt_b2cd93"));
    } catch(err) { $('#knowledge-form-error').textContent=err.message; }
    finally { $('#knowledge-save').disabled=false; }
  };
  $('#knowledge-category-cancel').onclick = resetKnowledgeCategoryForm;
  $('#knowledge-category-list').onclick = async event => {
    const editButton = event.target.closest('[data-knowledge-category-edit]');
    if (editButton && editButton.dataset.knowledgeCategoryEdit !== undefined) {
      const category = knowledgeCategories.find(c => c.id === Number(editButton.dataset.knowledgeCategoryEdit));
      if (!category) return;
      editingKnowledgeCategoryId = category.id;
      $('#knowledge-category-name').value = category.name;
      $('#knowledge-category-add').textContent = t("ui.gem_navn_897c73");
      $('#knowledge-category-cancel').hidden = false;
      $('#knowledge-category-name').focus(); return;
    }
    const deleteButton = event.target.closest('[data-knowledge-category-delete]');
    if (deleteButton && deleteButton.dataset.knowledgeCategoryDelete !== undefined) {
      const category = knowledgeCategories.find(c => c.id === Number(deleteButton.dataset.knowledgeCategoryDelete));
      if (!category || category.article_count > 0 || !confirm(t("ui.slet_kategorien_7f91af", {p0: category.name}))) return;
      deleteButton.disabled = true;
      try {
        await request(`/api/knowledge-categories/${category.id}`, {method:'DELETE'});
        if ($('#knowledge-category_id').value === String(category.id)) $('#knowledge-category_id').value = '';
        if (editingKnowledgeCategoryId === category.id) resetKnowledgeCategoryForm();
        await showKnowledgeRoute(); notify(t("ui.kategorien_er_slettet_77bba8"));
      } catch(error) { $('#knowledge-error').textContent = error.message; deleteButton.disabled = false; }
      return;
    }
    const button = event.target.closest('[data-knowledge-category]');
    if (!button) return;
    $('#knowledge-category_id').value = button.dataset.knowledgeCategory;
    return loadKnowledge();
  };
  $('#knowledge-results').onclick = event => {
    const button = event.target.closest('[data-knowledge-tag]');
    if (!button) return;
    $('#knowledge-tag').value = button.dataset.knowledgeTag;
    return loadKnowledge();
  };
  $('#knowledge-tag').onchange = () => loadKnowledge();
  $('#knowledge-filters').onsubmit = event => { event.preventDefault(); loadKnowledge(); };
  $('#knowledge-category-form').onsubmit = async event => {
    event.preventDefault(); const button=$('#knowledge-category-add'); button.disabled=true;
    try { const editing = editingKnowledgeCategoryId !== null; await request('/api/knowledge-categories'+(editing ? '/'+editingKnowledgeCategoryId : ''),{method:editing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#knowledge-category-name').value})}); resetKnowledgeCategoryForm(); await showKnowledgeRoute(); notify(editing ? t("ui.kategorien_er_omdoebt_d00330") : t("ui.kategorien_er_oprettet_de25a2")); }
    catch(err) { $('#knowledge-error').textContent=err.message; } finally {button.disabled=false;}
  };
  $('#knowledge-ai-generate').onclick = () => generateKnowledgeProposal(Number($('#knowledge-ai-print').value), $('#knowledge-ai-generate'), '#knowledge-ai-error');
  $('#print-knowledge-generate').onclick = () => {
    const button = $('#print-knowledge-generate');
    if ($('#print-note').value !== button.dataset.note || $('#print-name').value !== button.dataset.name || $('#print-status').value !== button.dataset.status) {
      $('#print-error').textContent=t("ui.gem_aendringerne_til_navn_note_og_status_og_aabn_d10f0c"); return;
    }
    return generateKnowledgeProposal(Number(button.dataset.printId), button, '#print-error');
  };
}

export { initKnowledge, showKnowledgeRoute };
