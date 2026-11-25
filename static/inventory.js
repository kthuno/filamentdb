import { t, th, getLocale, tn } from './i18n.js';
import { load } from './actions.js';
import { openConsumption } from './consumption.js';
import { $, compareLocations, esc, notify, number, productLink, purchaseLabel, request } from './core.js';
import { inventoryState } from './inventory-data.js';
import { populateLocations } from './locations.js';
let lastHandledLink = null;
function resetSpoolLink() { lastHandledLink = null; }
// Inventory cards, filters and spool editing.
function populateMaterialTypes(names) { $('#material-list').innerHTML = names.map(name => '<option value="' + esc(name) + `"></option>`).join(''); }
const materialKey = value => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('da');
function summarizeMaterials(records) {
  const groups = new Map();
  for (const spool of records) {
    const label = spool.material.trim().replace(/\s+/g, ' ');
    const key = label.toLocaleLowerCase('da');
    if (!groups.has(key)) groups.set(key, {name: label, remaining: 0, total: 0, available: 0});
    const group = groups.get(key);
    group.remaining += spool.remaining;
    group.total += 1;
    if (spool.remaining > 0) group.available += 1;
  }
  return [...groups.values()].sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name, getLocale()));
}
const expandedMaterials = new Set();
function summarizeMaterialColors(records, material) {
  const colors = new Map();
  for (const spool of records.filter(item => materialKey(item.material) === materialKey(material))) {
    const name = (spool.color || '').trim().replace(/\s+/g, ' ') || (spool.transparency === 'transparent' ? t("ui.transparent_aac7e8") : t("ui.ingen_farve_angivet_930385"));
    const key = materialKey(name);
    if (!colors.has(key)) colors.set(key, {name, color: /^#[0-9a-f]{6}$/i.test(spool.color_hex) ? spool.color_hex : '#bd93f9', remaining:0, total:0, available:0});
    const color = colors.get(key);
    color.remaining += spool.remaining;
    color.total++;
    if (spool.remaining > 0) color.available++;
  }
  return [...colors.values()].sort((a,b) => b.remaining-a.remaining || a.name.localeCompare(b.name,getLocale()));
}
function renderMaterialOverview(materials, inventory) {
  if (!materials.length) return `<p class="material-empty">${th("ui.tilfoej_filament_for_at_se_dit_lager_fordelt_paa_18ef36")}</p>`;
  const weight = remaining => `<td class="material-weight">${number(remaining / 1000)} kg <small>${th("ui.g_f7739a", {p1: number(remaining)})}</small></td>`;
  return `<table><thead><tr><th scope="col">${th("ui.materiale_type_c9114d")}</th><th scope="col">${th("ui.tilbage_3b8d1a")}</th><th scope="col">${th("ui.ruller_paa_lager_22a60c")}</th><th scope="col">${th("ui.tomme_ruller_4a43a3")}</th></tr></thead>${materials.map((group,index) => {
    const key = materialKey(group.name);
    const expanded = expandedMaterials.has(key);
    return `<tbody><tr><th scope="row"><span class="material-type-heading"><button type="button" class="material-toggle" data-toggle-material="${esc(group.name)}" aria-expanded="${expanded}" aria-controls="material-colors-${index}" aria-label="${th("ui.vis_farver_for_967721", {p3: esc(group.name)})}">${expanded ? '▾' : '▸'}</button><a href="#cards" data-filter-material="${esc(group.name)}" aria-label="${th("ui.vis_spoler_af_typen_065816", {p6: esc(group.name)})}">${esc(group.name)}</a></span></th>${weight(group.remaining)}<td>${group.available}</td><td>${group.total-group.available}</td></tr></tbody><tbody id="material-colors-${index}"${expanded ? '' : ' hidden'} class="material-color-rows">${summarizeMaterialColors(inventory,group.name).map(color => `<tr><th scope="row"><span class="material-color-name"><span class="material-color-branch" aria-hidden="true">↳</span><span class="material-color-swatch" style="--color:${color.color}" aria-hidden="true"></span>${esc(color.name)} <small>(${color.total} ${tn("ui.spole_8101b6", "ui.spoler_cde0a7", color.total, true)})</small></span></th>${weight(color.remaining)}<td>${color.available}</td><td>${color.total-color.available}</td></tr>`).join('')}</tbody>`;
  }).join('')}</table>`;
}
function groupFilaments(records) {
  const groups = new Map();
  const fields = ['name', 'manufacturer', 'material', 'product_id', 'product_url', 'color', 'color_hex', 'transparency', 'diameter', 'weight', 'purchase_format', 'archived'];
  for (const spool of records) {
    const key = JSON.stringify(fields.map(field => spool[field] ?? ''));
    if (!groups.has(key)) groups.set(key, {...spool, remaining: 0, weight: 0, members: []});
    const group = groups.get(key);
    group.members.push(spool);
    group.remaining += spool.remaining;
    group.weight += spool.weight;
    const locations = [...new Set(group.members.map(item => item.location || t("ui.ingen_placering_96a4dd")))];
    group.location = locations.length === 1 ? locations[0] : t("ui.flere_placeringer_66f9b6");
  }
  return [...groups.values()];
}
function spoolActionButtons(spool) {
  const consumeIcon = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3v10m-4-4 4 4 4-4M5 14v6h14v-6"/></svg>`;
  return `<button type="button" class="spool-action-icon" data-consume="${spool.id}" title="${th("ui.registrer_forbrug_ca945d")}" aria-label="${th("ui.registrer_forbrug_paa_db38c3", {p1: esc(spool.name)})}">${consumeIcon}</button>`;
}
function renderInventory() {
  const inventory = inventoryState.spools.filter(spool => !spool.archived);
  $('#material-overview').innerHTML = renderMaterialOverview(summarizeMaterials(inventory), inventory);
  $('#nav-count').textContent = inventory.length;
  const query = $('#search').value.toLocaleLowerCase('da'); const material = $('#material-filter').value; const stock = $('#stock-filter').value;
  let filtered = inventoryState.spools.filter(s => ($('#archive-filter').value === 'all' || ($('#archive-filter').value === 'archived' ? Boolean(s.archived) : !s.archived)) && [s.name,s.product_id,s.manufacturer,s.material,s.color,s.location,s.notes,s.transparency === 'transparent' ? 'transparent' : '',purchaseLabel(s.purchase_format)].join(' ').toLocaleLowerCase('da').includes(query) && (!material || materialKey(s.material) === materialKey(material)) && (!stock || (stock === 'available' ? s.remaining > 0 : stock === 'empty' ? s.remaining === 0 : s.remaining > 0 && s.remaining/s.weight < .2)));
  const groups = $('#sort').value === 'location' ? filtered.map(s => ({...s,members:[s]})) : groupFilaments(filtered);
  if ($('#sort').value === 'name') groups.sort((a,b) => a.name.localeCompare(b.name,getLocale())); if ($('#sort').value === 'remaining') groups.sort((a,b) => a.remaining-b.remaining);
  $('#count').textContent = t("ui.kort_6b5c86", {p0: filtered.length, p1: tn("ui.spole_8101b6", "ui.spoler_cde0a7", filtered.length, false), p2: groups.length});
  if ($('#sort').value === 'location') groups.sort(compareLocations);
  $('#cards').innerHTML = groups.map(s => { const percent = Math.round(s.remaining/s.weight*100); const color = /^#[a-f0-9]{6}$/i.test(s.color_hex) ? s.color_hex : '#bd93f9'; return `<article class="card${s.members.length > 1 ? ' grouped-card' : ''}" tabindex="0" ${s.members.length === 1 ? `data-edit="${s.id}" aria-label="${th("ui.rediger_4d69d1", {p1: esc(s.name)})}"` : `data-expand aria-label="${th("ui.vaelg_en_spole_fra_30faee", {p0: esc(s.name)})}"`}><div class="card-body"><div class="spool-card-heading"><div class="spool-card-copy"><div class="spool-card-labels"><span class="badge">${esc(s.material)}</span>${s.members.length > 1 ? `<span class="quantity-badge">${th("ui.spoler_9cc3c1", {p0: s.members.length})}</span>` : ''}</div><div class="manufacturer">${esc(s.manufacturer)}</div><h3>${esc(s.name)}${s.archived ? ` <small class="archived-label">${th("ui.arkiveret_e47d8a")}</small>` : ''}</h3>${s.product_id ? `<div class="product-id">${th("ui.produkt_id_ed128a", {p0: esc(s.product_id)})}</div>` : ''}<div class="color-name"><span class="swatch" style="background:${color}"></span>${th("ui.mm_cd3f10", {p9: esc(s.color || (s.transparency === 'transparent' ? t("ui.klar_79aac7") : t("ui.ingen_farve_angivet_930385"))), p10: s.transparency === 'transparent' ? th("ui.transparent_c8a1fe") : '', p11: number(s.diameter)})}</div><div class="purchase-format">${esc(purchaseLabel(s.purchase_format))}</div></div><div class="spool-card-graphic" style="--spool:${color}" aria-hidden="true"><div class="spool${s.transparency === 'transparent' ? ' transparent-spool' : ''}"></div></div></div><button class="add-more" data-more="${s.id}">${th("ui.tilfoej_flere_930012")}</button>${productLink(s.product_url) ? `<a class="repurchase" href="${esc(productLink(s.product_url))}" target="_blank" rel="noopener noreferrer">${th("ui.genkoeb_0bf2e8")}</a>` : ''}<div class="weight-label"><span><b>${number(s.remaining)} g</b>${th("ui.g_1b1ff7", {p17: number(s.weight)})}</span><span>${th("ui.tilbage_312c7e", {p19: percent})}</span></div><div class="bar"><span style="width:${percent}%;${percent<20?'background:#ffb86c':''}"></span></div><div class="card-bottom"><span class="location" title="${esc(s.location)}">⌖ ${esc(s.location || t("ui.ingen_placering_96a4dd"))}</span>${s.members.length === 1 ? `<div class="card-actions">${spoolActionButtons(s)}</div>` : `<span>${th("ui.samlet_vaegt_22607d")}</span>`}</div>${s.members.length > 1 ? `<details class="spool-members"><summary>${th("ui.se_og_rediger_spoler_6b9775", {p0: s.members.length})}</summary>${s.members.map(item => `<div class="spool-member" data-edit="${item.id}" tabindex="0" aria-label="${th("ui.rediger_4d69d1", {p1: esc(item.name)})}"><div><strong>${th("ui.g_bc1299", {p2: esc(item.name), p3: number(item.remaining)})}</strong><small>${esc(item.active_slot || item.location || t("ui.ingen_placering_96a4dd"))}${item.purchase_date ? th("ui.koebt_f68e8d") + esc(item.purchase_date) : ''}</small></div>${spoolActionButtons(item)}</div>`).join('')}</details>` : ''}</div></article>`; }).join('');
  $('#empty').hidden = filtered.length !== 0;
  $('#empty h2').textContent = inventoryState.spools.length ? t("ui.ingen_spoler_matcher_din_soegning_3382ad") : t("ui.et_godt_print_starter_med_en_spole_0f556f");
  $('#empty p').textContent = inventoryState.spools.length ? t("ui.proev_en_anden_soegning_eller_juster_dine_filtre_50d16c") : t("ui.tilfoej_din_foerste_spole_og_faa_overblik_over_d_0119c2");
  $('#empty-add').hidden = inventoryState.spools.length > 0;
}
function edit(id) { const archivedSpool = inventoryState.spools.find(s => s.id === id); $('#archive-spool').hidden = !id || (!archivedSpool?.archived && archivedSpool?.remaining !== 0); $('#archive-spool').textContent = archivedSpool?.archived ? t("ui.gendan_spole_bca63f") : t("ui.arkiver_spole_ee4372"); $('#archive-info').hidden = !archivedSpool?.archived; const form = $('#form'); form.reset(); form.elements.id.value = id || ''; $('#quantity-field').hidden = Boolean(id); form.elements.quantity.disabled = Boolean(id); $('#form-error').textContent = ''; $('#delete').hidden = !id; $('#modal-title').textContent = id ? t("ui.rediger_filament_0d31aa") : t("ui.tilfoej_filament_5228ff"); if(id) { const spool = inventoryState.spools.find(s => s.id === id); for(const [key,value] of Object.entries(spool)) if(form.elements.namedItem(key)) form.elements.namedItem(key).value = value; } populateLocations(id); $('#editor').showModal(); }
function addMore(id) {
  const source = inventoryState.spools.find(s => s.id === id);
  if (!source) return;
  edit();
  const form = $('#form');
  for (const key of ['name','manufacturer','material','color','color_hex','transparency','product_id','product_url','purchase_format','weight','diameter','price','nozzle_temp','bed_temp']) {
    if (form.elements.namedItem(key)) form.elements.namedItem(key).value = source[key] ?? '';
  }
  form.elements.remaining.value = source.weight;
  const today = new Date();
  form.elements.purchase_date.value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  $('#modal-title').textContent = t("ui.tilfoej_flere_af_samme_filament_170c70");
  form.elements.quantity.focus();
}
async function handleSpoolLink() {
  if (!inventoryState.loaded) return;
  const hash = window.location.hash;
  if (!hash.startsWith('#spool/')) { lastHandledLink = null; return; }
  if (lastHandledLink === hash) return;
  lastHandledLink = hash;
  const spool = inventoryState.spools.find(s => '#spool/' + s.label_token === hash);
  if (!spool) { notify(t("ui.spolen_i_linket_findes_ikke_laengere_128284")); return; }
  await openConsumption(spool.id);
}

function initInventory() {
  $('#add').onclick = $('#empty-add').onclick = () => edit();
  $('#close').onclick = $('#cancel').onclick = () => $('#editor').close();
  $('#cards').onclick = e => { const more = e.target.closest('[data-more]'); if(more) { addMore(Number(more.dataset.more)); return; } const consume = e.target.closest('[data-consume]'); if (consume) { openConsumption(Number(consume.dataset.consume)); return; } if (e.target.closest('button, a, summary')) return; const target = e.target.closest('[data-edit]'); if(target) { edit(Number(target.dataset.edit)); return; } const card = e.target.closest('[data-expand]'); if(card && !e.target.closest('details')) card.querySelector('details').open = true; };
  $('#cards').onkeydown = event => { if (!['Enter', ' '].includes(event.key) || !event.target.matches('[data-edit], [data-expand]')) return; event.preventDefault(); event.target.click(); };
  $('#material-overview').onclick = event => {
    const toggle = event.target.closest('[data-toggle-material]');
    if (toggle) {
      const key = materialKey(toggle.dataset.toggleMaterial);
      if (expandedMaterials.has(key)) expandedMaterials.delete(key); else expandedMaterials.add(key);
      const expanded = expandedMaterials.has(key);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? '▾' : '▸';
      document.getElementById(toggle.getAttribute('aria-controls')).hidden = !expanded;
      return;
    }
    const link = event.target.closest('[data-filter-material]');
    if (!link) return;
    event.preventDefault();
    const spool = inventoryState.spools.find(item => materialKey(item.material) === materialKey(link.dataset.filterMaterial));
    if (!spool) return;
    $('#material-filter').value = spool.material;
    renderInventory();
    $('#cards').scrollIntoView?.({behavior:'smooth',block:'start'});
  };
  for(const id of ['search','material-filter','archive-filter','stock-filter','sort']) $('#'+id).addEventListener('input',renderInventory);
  $('#form').onsubmit = async e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); const id = data.id; data.price = e.target.elements.price.value; delete data.id; const selected = $('#location-picker').value; [data.location_id, data.location_slot] = selected ? selected.split(':').map(Number) : [null,null]; const quantity = id ? 1 : Number(data.quantity); if (!id) data.quantity = quantity; $('#save').disabled = true; try { await request('/api/filaments'+(id?'/'+id:''),{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); $('#editor').close(); await load(); notify(!id && quantity > 1 ? t("ui.spoler_er_oprettet_255e1f", {p0: quantity}) : t("ui.filamentet_er_gemt_bf337d")); } catch(error) { $('#form-error').textContent = error.message; } finally { $('#save').disabled = false; } };
  $('#archive-spool').onclick = async () => {
    const id = Number($('#form').elements.id.value);
    const spool = inventoryState.spools.find(item => item.id === id);
    if (!spool) return;
    if (!spool.archived && !confirm(t("ui.arkiver_den_tomme_spole_placeringen_frigives_og__8bd199"))) return;
    $('#archive-spool').disabled = true;
    try {
      await request(`/api/filaments/${id}/archive`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({archived:!spool.archived})});
      $('#editor').close(); await load(); notify(spool.archived ? t("ui.spolen_er_gendannet_uden_placering_27b388") : t("ui.spolen_er_arkiveret_og_placeringen_er_frigivet_d25ff4"));
    } catch(error) { $('#form-error').textContent = error.message; }
    finally { $('#archive-spool').disabled = false; }
  };
  $('#delete').onclick = async () => { if(!confirm(t("ui.vil_du_slette_denne_spole_permanent_9139bf"))) return; try { await request('/api/filaments/'+$('#form').elements.id.value,{method:'DELETE'}); $('#editor').close(); await load(); notify(t("ui.spolen_er_slettet_837e32")); } catch(error) { $('#form-error').textContent = error.message; } };
  $('#open-product-link').onclick = () => { const link = productLink($('#product-url').value.trim()); if (!link) { $('#form-error').textContent = t("ui.indtast_et_gyldigt_produktlink_med_http_eller_ht_633e6a"); $('#product-url').focus(); return; } window.open(link, '_blank', 'noopener,noreferrer'); };
}

export { edit, handleSpoolLink, initInventory, populateMaterialTypes, renderInventory, resetSpoolLink, summarizeMaterials };
