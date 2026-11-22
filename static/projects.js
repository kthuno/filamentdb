import { t, th } from './i18n.js';
import { loadFileArchive } from './actions.js';
import { $, esc, formatPrintTime, notify, number, productLink, purchaseLabel, request } from './core.js';
import { PrintEditor } from './prints.js';
// Upcoming projects are estimates only. Inventory changes exclusively via the print form.
let buildPlates = [];
function buildPlateGraphic(identity) {
  const key = `build-plate-art-${identity}`;
  const outline = 'M82 32H218Q224 32 227 39L273 139Q279 152 265 152H35Q21 152 27 139L73 39Q76 32 82 32Z';
  return `<svg class="build-plate-graphic" viewBox="0 0 300 200" fill="none" aria-hidden="true" focusable="false"><defs><linearGradient id="${key}-surface" x1="65" y1="35" x2="235" y2="160" gradientUnits="userSpaceOnUse"><stop stop-color="#656179"/><stop offset=".5" stop-color="#383747"/><stop offset="1" stop-color="#494354"/></linearGradient><linearGradient id="${key}-edge" x1="35" y1="144" x2="265" y2="158" gradientUnits="userSpaceOnUse"><stop stop-color="#bd93f9"/><stop offset=".5" stop-color="#75638d"/><stop offset="1" stop-color="#ff79c6"/></linearGradient><pattern id="${key}-texture" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="skewX(-12)"><circle cx="2" cy="2" r=".7" fill="#d8c7ee" fill-opacity=".22"/><path d="M0 9H9V0" stroke="#d8c7ee" stroke-opacity=".05" stroke-width=".6"/></pattern></defs><ellipse cx="150" cy="172" rx="116" ry="12" fill="#171820" fill-opacity=".5"/><path d="M27 144L34 160H266L273 144Z" fill="url(#${key}-edge)"/><path d="${outline}" fill="url(#${key}-surface)" stroke="#b9a0d3" stroke-width="1.2"/><path d="${outline}" fill="url(#${key}-texture)"/><path d="M87 42H213L257 139H43Z" stroke="#bd93f9" stroke-opacity=".3"/><path d="M87 50H103M85 50L81 61M197 50H213L218 61M56 122L51 133H69M231 133H249L244 122" stroke="#8be9fd" stroke-width="1.8" stroke-linecap="round" opacity=".65"/><path d="M126 152H174L178 167Q179 172 173 172H127Q121 172 122 167Z" fill="#4d455f" stroke="#b49acb"/><path d="M137 161H163" stroke="#bd93f9" stroke-width="2" stroke-linecap="round"/><path d="M134 94L150 84L166 94L150 104Z" stroke="#cfb2f4" stroke-width="1.3"/><path d="M134 101L150 111L166 101M134 108L150 118L166 108" stroke="#cfb2f4" stroke-opacity=".55" stroke-width="1.3"/><path d="M82 33H218" stroke="#e6d5ff" stroke-opacity=".5" stroke-linecap="round"/></svg>`;
}
async function loadBuildPlates() {
  buildPlates = await request('/api/build-plates');
  $('#build-plate-count').textContent = `${buildPlates.length} ${buildPlates.length === 1 ? 'pladetype' : 'pladetyper'}`;
  $('#build-plate-list').innerHTML = buildPlates.map(plate => `<article class="build-plate-card"><div class="build-plate-art"><span class="build-plate-tag">${th("ui.printoverflade_ff3a29")}</span>${buildPlateGraphic(plate.id)}</div><div class="build-plate-card-body"><div class="build-plate-card-copy"><h3>${esc(plate.name)}</h3><p>${th("ui.byggeplade_til_dine_kommende_projekter_8f7fff")}</p></div><div class="build-plate-card-actions"><button type="button" data-edit-build-plate="${plate.id}" aria-label="${th("ui.rediger_01adf3", {p3: esc(plate.name)})}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z"/></svg>${th("ui.rediger_ac8441")}</button><button type="button" class="danger" data-delete-build-plate="${plate.id}" aria-label="${th("ui.slet_72b8f0", {p5: esc(plate.name)})}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg>${th("ui.slet_b9f4c0")}</button></div></div></article>`).join('') || `<div class="build-plate-empty">${buildPlateGraphic('empty')}<h3>${th("ui.ingen_byggeplader_endnu_34dfdb")}</h3><p>${th("ui.opret_en_pladetype_saa_du_kan_vaelge_den_til_kom_fc5754")}</p></div>`;
}
function resetBuildPlateForm() {
  $('#build-plate-form').reset(); $('#build-plate-id').value = ''; $('#build-plate-error').textContent = '';
  $('#build-plate-form-title').textContent = t("ui.ny_byggeplade_5507d6");
  $('#build-plate-save').textContent = t("ui.opret_byggeplade_f2d52a"); $('#build-plate-cancel').hidden = true;
}
let upcomingProjects = [];
let projectDraft = null;
let projectEditingId = null;
let projectBusy = false;
async function loadProjects() {
  $('#projects-error').textContent = '';
  try { [upcomingProjects] = await Promise.all([request('/api/projects'),loadBuildPlates(),loadPlanning()]); renderProjects(); }
  catch(error) { $('#projects-error').textContent = error.message; }
}
function renderProjects() {
  $('#projects-status').textContent = t("ui.kommende_projekter_a85cf3", {p0: upcomingProjects.filter(project => project.print_id == null).length});
  $('#projects-list').innerHTML = upcomingProjects.map(project => {
    const plate = project.metadata.plate;
    const demand = projectDemandSummary(project);
    const quantity = plate.quantity ?? 1;
    const duration = plate.estimated_seconds == null ? null : Math.ceil(plate.estimated_seconds*quantity/60);
    return `<article class="project-card">${project.has_image ? `<img src="/api/projects/${project.id}/image" alt="${esc(project.name)}" loading="lazy">` : `<div class="project-no-image" aria-hidden="true">▧</div>`}<div><span class="ams-model">${project.print_id == null ? th("ui.planlagt_intet_lagertraek_dc0ca4") : th("ui.registreret_som_print_1981d2")}</span><h2>${esc(project.name)}</h2><p>${esc(plate.name)}${quantity > 1 ? th("ui.stk_6fda22", {p0: quantity}) : ''} · ${esc(project.metadata.printer || t("ui.printer_ikke_angivet_bfe1b4"))}</p><p>${th("ui.byggeplade_b5e962", {p6: esc(project.build_plate_name || t("ui.ikke_angivet_898bb9"))})}</p><p>${th("ui.filament_60c4a1", {p7: esc((project.filament_types || []).join(', ') || t("ui.ikke_angivet_898bb9"))})}</p><p>${esc(formatPrintTime(duration))} · ${plate.estimated_grams == null ? th("ui.gram_ikke_angivet_213d5c") : `${number(plate.estimated_grams*quantity)} g`} <small>${th("ui.estimat_5e8aec")}</small></p>${demand}${project.archive_file_id ? `<p><a class="file-source-link" href="#files/${project.archive_file_id}">${th("ui.aabn_originalfil_i_filarkivet_aa1d6a")}</a></p>` : ''}<div class="project-actions">${project.print_id == null ? `<button data-open-project="${project.id}">${th("ui.se_rediger_a49e7c")}</button><button class="primary" data-start-project="${project.id}">${th("ui.registrer_print_3f1950")}</button><button class="danger" data-delete-project="${project.id}">${th("ui.slet_b9f4c0")}</button>` : `<button data-project-print="${project.print_id}">${th("ui.aabn_print_0d807d")}</button><button class="danger" data-delete-project="${project.id}">${th("ui.slet_projekt_3ea784")}</button>`}</div></div></article>`;
  }).join('') || `<p>${th("ui.ingen_kommende_projekter_endnu_opret_et_projekt__716441")}</p>`;
}
async function projectJpeg(data) {
  if (!data) return '';
  const image = new Image(); image.src = data; await image.decode();
  if (image.naturalWidth*image.naturalHeight > 16000000) throw new Error(t("ui.thumbnail_har_for_stor_oploesning_19f186"));
  const scale = Math.min(1,960/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const result = canvas.toDataURL('image/jpeg',0.8);
  if (result.length>700000) throw new Error(t("ui.thumbnail_er_for_stor_efter_konvertering_ef979e"));
  return result;
}
function activeProjectPlate() { return projectDraft.plates[Number($('#project-plate').value) || 0]; }
function renderProjectPlate() {
  const plate = activeProjectPlate();
  const minutes = plate.estimated_seconds == null ? null : Math.ceil(plate.estimated_seconds/60);
  $('#project-hours').value = minutes == null ? '' : Math.floor(minutes/60);
  $('#project-minutes').value = minutes == null ? '' : minutes%60;
  $('#project-grams').value = plate.estimated_grams ?? '';
  $('#project-quantity').value = plate.quantity ?? 1;
  renderProjectQuantityTotal();
  $('#project-preview').hidden = !plate.thumbnail;
  if (plate.thumbnail) $('#project-preview').src = plate.thumbnail; else $('#project-preview').removeAttribute('src');
  const used = plate.filaments.length ? plate.filaments.map(line => `<li>${th("ui.filament_9c34d4", {p0: esc(line.id), p1: esc(line.type), p2: esc(line.color)})}<input type="number" min="0" max="1000000" step="any" data-project-filament="${esc(line.id)}" aria-label="${th("ui.estimeret_gram_for_filament_60141b", {p4: esc(line.id)})}" value="${line.grams ?? ''}"> g</li>`).join('') : `<li>${th("ui.intet_beregnet_forbrug_pr_filament_spoler_og_gra_cae243")}</li>`;
  $('#project-details').innerHTML = `<p>${th("ui.laghoejde_mm_fyld_licens_64a4e7", {p0: esc(projectDraft.layer_height || t("ui.ikke_angivet_898bb9")), p1: esc(projectDraft.infill || t("ui.ikke_angivet_898bb9")), p2: esc(projectDraft.license || t("ui.ikke_angivet_898bb9"))})}</p><h3>${th("ui.forbrug_pr_filament_printplade_f2de5e")}</h3><ul>${used}</ul>${projectProductSelectors(plate)}<h3>${th("ui.objekter_5679c1")}</h3><p>${esc(plate.objects.filter(Boolean).join(', ') || t("ui.ikke_angivet_898bb9"))}</p><details><summary>${th("ui.konfigurerede_filamenter_i_filen_ikke_noedvendig_3d0f50")}</summary><ul>${projectDraft.configured_filaments.map(line => `<li>${esc(line.id)} · ${esc(line.profile || line.type)} · ${esc(line.color)}</li>`).join('') || `<li>${th("ui.ikke_angivet_898bb9")}</li>`}</ul></details>`;
}
function renderProjectQuantityTotal() {
  const plate = activeProjectPlate();
  const quantity = Number($('#project-quantity').value);
  $('#project-quantity-total').textContent = Number.isInteger(quantity) && quantity >= 1 && quantity <= 1000
    ? `${quantity} × ${plate.estimated_grams == null ? t("ui.ukendt_forbrug_3bd52b") : `${number(plate.estimated_grams)} g`} = ${plate.estimated_grams == null ? t("ui.ukendt_total_17534a") : t("ui.g_i_alt_6dd19a", {p0: number(plate.estimated_grams*quantity)})}` : '';
}
function rememberProjectPlate() {
  const plate = activeProjectPlate();
  const hours = $('#project-hours').value, minutes = $('#project-minutes').value;
  const seconds = hours === '' && minutes === '' ? null : (Number(hours || 0)*60+Number(minutes || 0))*60;
  // Keep the source's second precision unless the displayed hour/minute values change.
  const displayedSeconds = plate.estimated_seconds == null ? null : Math.ceil(plate.estimated_seconds/60)*60;
  if (seconds !== displayedSeconds) plate.estimated_seconds = seconds;
  plate.estimated_grams = $('#project-grams').value === '' ? null : Number($('#project-grams').value);
  plate.quantity = Number($('#project-quantity').value);
  renderProjectQuantityTotal();
  rememberProjectProducts(plate);
  for (const input of document.querySelectorAll('[data-project-filament]')) {
    const line = plate.filaments.find(line => line.id === input.dataset.projectFilament);
    if (line) line.grams = input.value === '' ? null : Number(input.value);
  }
}
function showProjectDraft(draft,id=null) {
  projectDraft = draft; projectEditingId = id;
  $('#project-form').reset(); $('#project-error').textContent = '';
  $('#project-filament-types').value = (draft.filament_types || []).join(', ');
  $('#project-name').value = draft.name; $('#project-note').value = draft.note || ''; $('#project-url').value = draft.project_url || '';
  $('#project-source').textContent = `${draft.filename} · ${draft.application || '3MF'} · ${draft.printer || t("ui.printer_ikke_angivet_bfe1b4")}${draft.designer ? ` · ${draft.designer}` : ''}`;
  $('#project-archive-link').hidden = !draft.archive_file_id;
  $('#project-archive-link').href = draft.archive_file_id ? `#files/${draft.archive_file_id}` : '#files';
  $('#project-warnings').textContent = (draft.warnings || []).join(' ');
  $('#project-plate').innerHTML = draft.plates.map((plate,index) => `<option value="${index}">${esc(plate.name)} (${esc(plate.id)})</option>`).join('');
  $('#project-build-plate').innerHTML = `<option value="">${th("ui.ikke_angivet_898bb9")}</option>` + buildPlates.map(plate => `<option value="${plate.id}">${esc(plate.name)}</option>`).join('');
  const defaultPlate = id == null ? buildPlates.find(plate => plate.name.toLocaleLowerCase('da') === 'textured pei')?.id : null;
  $('#project-build-plate').value = String(draft.build_plate_id ?? defaultPlate ?? '');
  $('#project-plate').value = '0'; renderProjectPlate(); $('#project-dialog').showModal();
}
async function offerCompletedProjectDeletion(printId, projectId) {
  try {
    const projects = await request('/api/projects');
    const project = projects.find(item => item.print_status === 'completed' && (projectId != null ? item.id === projectId : item.print_id === printId));
    if (!project) return;
    if (confirm(t("ui.printet_er_gennemfoert_vil_du_slette_det_tilknyt_302561", {p0: project.name}))) {
      await request(`/api/projects/${project.id}`,{method:'DELETE'});
    }
    await loadProjects();
  } catch(error) { $('#usage-error').textContent = t("ui.printet_er_gemt_men_projektoprydning_kunne_ikke__0cb2d9", {p0: error.message}); }
}
async function startPlannedProject(project) {
  return PrintEditor.startProject(project);
}
// Product snapshots keep planned demand identifiable even after the last spool is gone.
const planningProductFields = ['name','manufacturer','material','product_id','product_url','color','color_hex','transparency','diameter','weight','purchase_format'];
const planningKey = product => JSON.stringify(planningProductFields.map(field => product[field]));
const planningLabel = product => t("ui.g_mm_727e28", {p0: product.manufacturer, p1: product.name, p2: product.material, p3: product.color || t("ui.farve_ikke_angivet_1d8da0"), p4: product.product_id ? ` · ${product.product_id}` : '', p5: number(product.weight), p6: purchaseLabel(product.purchase_format), p7: number(product.diameter)});
let planning = {products:[],needs:[],unresolved:[],wishes:[],estimate_warnings:[]};
let projectProductOptions = [];
async function loadPlanning() {
  planning = await request('/api/planning');
  renderPlanning();
}
function projectProductSelectors(plate) {
  const choices = plate.material_choices || [];
  projectProductOptions = planning.products.map(entry => entry.product);
  for (const product of choices) {
    if (product && !projectProductOptions.some(item => planningKey(item) === planningKey(product))) projectProductOptions.push(product);
  }
  return `<h3>${th("ui.vaelg_filament_0786ce")}</h3>${(plate.filaments.length ? plate.filaments : [{}]).map((line,index) => `<label class="planning-product">${plate.filaments.length ? th("ui.filament_9bbf19", {p0: esc(line.id)}) : th("ui.samlet_forbrug_e7ba89")}<select data-project-product="${index}"><option value="">${th("ui.produkt_ikke_valgt_fdcec8")}</option>${projectProductOptions.map((product,option) => `<option value="${option}"${choices[index] && planningKey(choices[index]) === planningKey(product) ? ' selected' : ''}>${esc(planningLabel(product))}</option>`).join('')}</select></label>`).join('')}`;
}
function rememberProjectProducts(plate) {
  const selects = document.querySelectorAll('[data-project-product]');
  if (!selects.length) return;
  plate.material_choices = Array.from(selects,select => select.value === '' ? null : projectProductOptions[Number(select.value)] || null);
}
function projectDemandSummary(project) {
  if (project.print_id != null) return '';
  const entries = planning.needs.flatMap(need => need.projects.filter(ref => ref.project_id === project.id).map(ref => {
    const amount = ref.grams == null ? t("ui.ukendt_behov_f38f22") : t("ui.g_behov_g_paa_lager_a42589", {p0: number(ref.grams), p1: number(need.available)});
    const warning = ref.grams != null && (ref.per_print_grams ?? ref.grams) > need.largest_spool && (ref.per_print_grams ?? ref.grams) <= need.available ? t("ui.kraever_spoleskift_4be0a9") : '';
    return `<li>${esc(need.product.name)}: ${amount}${warning}</li>`;
  }));
  const unresolved = planning.unresolved.filter(ref => ref.project_id === project.id).length;
  return entries.length || unresolved ? `<div class="project-demand"><strong>${th("ui.filamentbehov_0e7d3f")}</strong><ul>${entries.join('')}</ul>${unresolved ? `<p>${th("ui.linje_r_mangler_produktvalg_a2fdbf", {p0: unresolved})}</p>` : ''}</div>` : '';
}
function planningBuyLink(url) {
  const safe = productLink(url);
  return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${th("ui.find_i_butik_a85807")}</a>` : '';
}
function planningProductHeading(product) {
  const color = /^#[0-9a-f]{6}$/i.test(product.color_hex) ? product.color_hex : '#bd93f9';
  return `<div class="planning-product-heading"><span class="planning-swatch" style="--filament-color:${color}" aria-hidden="true"></span><div><strong>${esc(product.name)}</strong><small>${esc(product.manufacturer)} · ${esc(product.color || t("ui.farve_ikke_angivet_1d8da0"))}</small></div><span class="planning-material">${esc(product.material)}</span></div>`;
}
function planningProductDetails(product) {
  return `<span>${th("ui.g_mm_0ecead", {p0: number(product.weight), p1: esc(purchaseLabel(product.purchase_format)), p2: number(product.diameter), p3: product.product_id ? ` · ${esc(product.product_id)}` : ''})}</span>`;
}
function renderPlanning() {
  const shortages = planning.needs.filter(need => need.missing > 0);
  const missing = shortages.reduce((sum,need) => sum+need.missing,0);
  const attention = planning.unresolved.length + planning.needs.reduce((sum,need) => sum+need.unknown,0) + (planning.estimate_warnings || []).length;
  const projects = new Set([...planning.needs.flatMap(need => need.projects.map(ref => ref.project_id)),...planning.unresolved.map(ref => ref.project_id)]).size;
  $('#planning-summary').innerHTML = `<div><span>${th("ui.kommende_projekter_7aba40")}</span><strong>${projects}</strong></div><div class="${missing ? 'is-warning' : 'is-ready'}"><span>${th("ui.mangler_til_projekter_b85be8")}</span><strong>${number(missing)} <small>g</small></strong></div><div><span>${th("ui.paa_indkoebslisten_a35689")}</span><strong>${shortages.length + planning.wishes.length} <small>${th("ui.produkter_oensker_de8b40")}</small></strong></div>`;
  $('#planning-needs').innerHTML = planning.needs.length ? `<div class="planning-need-grid">${planning.needs.map(need => {
    const status = need.missing > 0 ? th("ui.mangler_filament_0e309b") : need.unknown ? th("ui.ukendt_behov_f38f22") : th("ui.daekket_af_lager_1fd46c");
    const coverage = need.required > 0 ? Math.min(100,need.available/need.required*100) : 0;
    return `<article class="planning-need-card">${planningProductHeading(need.product)}<div class="planning-amounts"><div><span>${th("ui.behov_40d86a")}</span><strong>${number(need.required)} g${need.unknown ? th("ui.ukendt_888dae") : ''}</strong></div><div><span>${th("ui.paa_lager_633729")}</span><strong>${number(need.available)} g</strong></div><div class="${need.missing ? 'is-warning' : 'is-ready'}"><span>${th("ui.mangler_6b73a6")}</span><strong>${number(need.missing)} g</strong></div></div><div class="planning-coverage" aria-hidden="true"><span style="width:${coverage}%"></span></div><div class="planning-card-footer"><span class="planning-status ${need.missing || need.unknown ? 'is-warning' : 'is-ready'}">${status}</span>${need.split_required ? `<span class="planning-status is-warning">${th("ui.kraever_spoleskift_098177")}</span>` : ''}</div><details class="planning-card-details"><summary>${th("ui.produkt_projekter_52f880")}</summary>${planningProductDetails(need.product)}<ul>${need.projects.map(ref => `<li>${esc(ref.name)} <span>${ref.grams == null ? th("ui.ukendt_estimat_29f1ed") : `${number(ref.grams)} g`}</span></li>`).join('')}</ul></details></article>`;
  }).join('')}</div>` : `<div class="planning-empty"><span aria-hidden="true">◎</span><p>${th("ui.vaelg_filament_paa_et_projekt_for_at_se_behovet__3e2232")}</p></div>`;
  $('#planning-unresolved').innerHTML = attention ? `<details class="planning-attention"><summary>${th("ui.ting_at_afklare_8d3ec6", {p0: attention})}<span>${th("ui.vis_detaljer_e4c103")}</span></summary><ul>${planning.unresolved.map(ref => `<li><strong>${esc(ref.name)}</strong>${th("ui.linje_vaelg_produkt_8de21a", {p1: ref.line, p2: ref.grams == null ? th("ui.ukendt_estimat_29f1ed") : `${number(ref.grams)} g`})}</li>`).join('')}${planning.needs.flatMap(need => need.projects.filter(ref => ref.grams == null).map(ref => `<li>${th("ui.ukendt_estimat_8c13c6", {p0: esc(ref.name), p1: esc(need.product.name)})}</li>`)).join('')}${(planning.estimate_warnings || []).map(ref => `<li>${th("ui.linjerne_afviger_fra_totalestimatet_kontroller_f_6cbe79", {p0: esc(ref.name)})}</li>`).join('')}</ul></details>` : '';
  $('#shopping-shortages').innerHTML = shortages.map(need => `<article class="shopping-record shopping-shortage">${planningProductHeading(need.product)}<div class="shopping-buy"><strong>${th("ui.koeb_mindst_g_c079e1", {p1: number(need.missing)})}</strong>${need.unknown ? `<small>${th("ui.ukendt_behov_027607")}</small>` : ''}${planningBuyLink(need.product.product_url)}</div></article>`).join('') || `<p class="planning-empty-line">${th("ui.ingen_beregnede_projektmangler_e7a62d")}</p>`;
  $('#shopping-wishes').innerHTML = planning.wishes.map(wish => `<article class="shopping-record"><div class="shopping-wish-info"><strong>${esc(wish.name)}</strong><span class="shopping-wish-amount">${wish.grams == null ? th("ui.maengde_ikke_angivet_346f96") : `${number(wish.grams)} g`}</span>${wish.note ? `<p>${esc(wish.note)}</p>` : ''}${planningBuyLink(wish.product_url)}</div><div class="project-actions"><button type="button" data-edit-wish="${wish.id}">${th("ui.rediger_ac8441")}</button><button type="button" data-delete-wish="${wish.id}">${th("ui.fjern_b52dde")}</button></div></article>`).join('') || `<p class="planning-empty-line">${th("ui.ingen_oensker_endnu_a927dc")}</p>`;
}
function resetShoppingForm() {
  $('#shopping-editor').open = false; $('#shopping-form').reset(); $('#shopping-id').value = ''; $('#shopping-cancel').hidden = true; $('#shopping-save').textContent = t("ui.tilfoej_oenske_8d385a");
}

function initProjects() {
  $('#build-plate-cancel').onclick = resetBuildPlateForm;
  $('#build-plate-form').onsubmit = async event => {
    event.preventDefault(); $('#build-plate-save').disabled = true; $('#build-plate-error').textContent = '';
    const id = $('#build-plate-id').value;
    try { await request('/api/build-plates'+(id ? `/${id}` : ''),{method:id ? 'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#build-plate-name').value})}); resetBuildPlateForm(); await loadBuildPlates(); }
    catch(error) { $('#build-plate-error').textContent = error.message; }
    finally { $('#build-plate-save').disabled = false; }
  };
  $('#build-plate-list').onclick = async event => {
    const edit = event.target.closest('[data-edit-build-plate]');
    if (edit) { const plate = buildPlates.find(item => item.id === Number(edit.dataset.editBuildPlate)); if (!plate) return; $('#build-plate-id').value = plate.id; $('#build-plate-name').value = plate.name; $('#build-plate-form-title').textContent = t("ui.rediger_byggeplade_d2e9c7"); $('#build-plate-name').focus(); $('#build-plate-save').textContent = t("ui.gem_aendringer_04d6e9"); $('#build-plate-cancel').hidden = false; return; }
    const remove = event.target.closest('[data-delete-build-plate]');
    if (!remove || !confirm(t("ui.slet_byggepladen_plader_i_brug_af_projekter_kan__07abd3"))) return;
    remove.disabled = true; $('#build-plate-error').textContent = '';
    try { await request(`/api/build-plates/${remove.dataset.deleteBuildPlate}`,{method:'DELETE'}); resetBuildPlateForm(); await loadBuildPlates(); }
    catch(error) { $('#build-plate-error').textContent = error.message; }
    finally { remove.disabled = false; }
  };
  $('#project-plate').onchange = renderProjectPlate;
  $('#project-archive-link').onclick = async event => {
    event.preventDefault();
    if (projectBusy || !projectDraft?.archive_file_id) return;
    $('#project-dialog').close();
    const hash = `#files/${projectDraft.archive_file_id}`;
    if (window.location.hash === hash) await loadFileArchive();
    else window.location.hash = hash;
  };
  for (const selector of ['#project-hours','#project-minutes','#project-grams','#project-quantity','#project-details']) $(selector).addEventListener('input',rememberProjectPlate);
  $('#project-close').onclick = $('#project-cancel').onclick = () => { if (!projectBusy) $('#project-dialog').close(); };
  $('#project-form').onsubmit = async event => {
    event.preventDefault(); if (projectBusy) return;
    projectBusy = true; $('#project-save').disabled = true; $('#project-error').textContent = '';
    try {
      rememberProjectPlate();
      const plate = activeProjectPlate();
      const {thumbnail,...savedPlate} = plate;
      const {plates,warnings,name,note,project_url,build_plate_id,filament_types,archive_file_id,...metadata} = projectDraft;
      const image = await projectJpeg(thumbnail);
      await request(projectEditingId == null ? '/api/projects' : `/api/projects/${projectEditingId}`,{method:projectEditingId == null ? 'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({archive_file_id:archive_file_id ?? null,name:$('#project-name').value,note:$('#project-note').value,project_url:$('#project-url').value,image,filament_types:$('#project-filament-types').value.split(',').map(value => value.trim()).filter(Boolean),build_plate_id:$('#project-build-plate').value ? Number($('#project-build-plate').value) : null,metadata:{...metadata,plate:savedPlate}})});
      $('#project-dialog').close(); await loadProjects(); notify(t("ui.kommende_projekt_gemt_uden_lagertraek_0036b3"));
    } catch(error) { $('#project-error').textContent = error.message; }
    finally { projectBusy = false; $('#project-save').disabled = false; }
  };
  $('#projects-list').onclick = async event => {
    const button = event.target.closest('button'); if (!button || projectBusy) return;
    projectBusy = true; button.disabled = true; $('#projects-error').textContent = '';
    try {
      if (button.dataset.deleteProject) {
        if (!confirm(t("ui.slet_projektet_eventuelle_print_lager_og_forbrug_913340"))) return;
        await request(`/api/projects/${button.dataset.deleteProject}`,{method:'DELETE'}); await loadProjects();
      } else if (button.dataset.projectPrint) {
        window.location.hash = '#usage'; await PrintEditor.open(Number(button.dataset.projectPrint));
      } else {
        const id = Number(button.dataset.openProject || button.dataset.startProject);
        await Promise.all([loadBuildPlates(),loadPlanning()]);
        const project = await request(`/api/projects/${id}`);
        if (button.dataset.startProject) await startPlannedProject(project);
        else { const {plate,...metadata} = project.metadata; showProjectDraft({...metadata,archive_file_id:project.archive_file_id,filament_types:project.filament_types,build_plate_id:project.build_plate_id,name:project.name,note:project.note,project_url:project.project_url,plates:[{...plate,thumbnail:project.image}],warnings:[t("ui.estimat_fra_den_importerede_fil_kontroller_oplys_7518e6")]},id); }
      }
    } catch(error) { $('#projects-error').textContent = error.message; }
    finally { projectBusy = false; button.disabled = false; }
  };
  $('#shopping-cancel').onclick = resetShoppingForm;
  $('#planning-refresh').onclick = async () => {
    $('#planning-error').textContent = '';
    try { await loadProjects(); } catch(error) { $('#planning-error').textContent = error.message; }
  };
  $('#shopping-form').onsubmit = async event => {
    event.preventDefault(); $('#shopping-save').disabled = true; $('#planning-error').textContent = '';
    const id = $('#shopping-id').value;
    try {
      await request('/api/shopping-wishes'+(id ? `/${id}` : ''),{method:id ? 'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#shopping-name').value,grams:$('#shopping-grams').value === '' ? null : Number($('#shopping-grams').value),product_url:$('#shopping-url').value,note:$('#shopping-note').value})});
      resetShoppingForm(); await loadPlanning();
    } catch(error) { $('#planning-error').textContent = error.message; }
    finally { $('#shopping-save').disabled = false; }
  };
  $('#shopping-wishes').onclick = async event => {
    const edit = event.target.closest('[data-edit-wish]');
    if (edit) {
      const wish = planning.wishes.find(item => item.id === Number(edit.dataset.editWish)); if (!wish) return;
      $('#shopping-editor').open = true; $('#shopping-id').value = wish.id; $('#shopping-name').value = wish.name; $('#shopping-grams').value = wish.grams ?? ''; $('#shopping-url').value = wish.product_url; $('#shopping-note').value = wish.note; $('#shopping-cancel').hidden = false; $('#shopping-save').textContent = t("ui.gem_oenske_fcc436"); $('#shopping-name').focus(); return;
    }
    const remove = event.target.closest('[data-delete-wish]'); if (!remove) return;
    remove.disabled = true; $('#planning-error').textContent = '';
    try { await request(`/api/shopping-wishes/${remove.dataset.deleteWish}`,{method:'DELETE'}); if ($('#shopping-id').value === remove.dataset.deleteWish) resetShoppingForm(); await loadPlanning(); }
    catch(error) { $('#planning-error').textContent = error.message; }
    finally { remove.disabled = false; }
  };
}

export { initProjects, loadBuildPlates, loadPlanning, loadProjects, offerCompletedProjectDeletion, showProjectDraft };
