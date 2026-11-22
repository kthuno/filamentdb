import { t, th, getLocale } from './i18n.js';
import { edit, load, loadUsage } from './actions.js';
import { $, esc, formatPrintTime, notify, number, request } from './core.js';
import { inventoryState, usageState } from './inventory-data.js';
import { PrintEditor } from './prints.js';
import { filterUsageGroups, groupUsage, normalizeUsageText, recentMonthlyUsage, sortUsageGroups, wasteReasons } from './usage-model.js';
// Single-spool consumption and grouped usage history.
let consumptionSpoolId = null;
function preferredSpool(records, lastId) {
  const available = records.filter(s => !s.archived && s.remaining > 0);
  return available.find(s => s.id === lastId) || available.find(s => s.active_slot) || available[0];
}
function rememberedSpool() { try { return Number(localStorage.getItem('last-consumption-spool')); } catch { return null; } }
async function openConsumption(id) {
  const chosen = id ? inventoryState.spools.find(s => s.id === id) : preferredSpool(inventoryState.spools, rememberedSpool());
  if (!chosen) { notify(t("ui.tilfoej_en_spole_med_filament_foer_du_registrere_f747e4")); return; }
  if (chosen.archived) { edit(chosen.id); notify(t("ui.spolen_er_arkiveret_gendan_den_foer_ny_brug_3c3540")); return; }
  consumptionSpoolId = chosen.id;
  $('#consumption-form').reset();
  $('#consumption-error').textContent = '';
  $('#consumption-spool').innerHTML = [...inventoryState.spools].sort((a,b) => Number(Boolean(b.active_slot)) - Number(Boolean(a.active_slot)) || b.id-a.id).map(s => `<option value="${s.id}" ${s.id === chosen.id ? 'selected' : ''}>${th("ui.g_5f8d76", {p2: esc(s.active_slot ? s.active_slot + ' · ' : ''), p3: esc(s.name), p4: esc(s.material), p5: number(s.remaining)})}</option>`).join('');
  if (!$('#consumption-dialog').open) $('#consumption-dialog').showModal();
  await refreshConsumptionSpool();
}
async function refreshConsumptionSpool() {
  const id = Number($('#consumption-spool').value);
  const spool = inventoryState.spools.find(s => s.id === id);
  if (!spool) return;
  consumptionSpoolId = id;
  $('#consumption-description').textContent = t("ui.g_tilbage_14d462", {p0: spool.name, p1: number(spool.remaining)});
  $('#consumption-grams').max = spool.remaining;
  $('#consumption-error').textContent = '';
  $('#consumption-history').textContent = t("ui.henter_historik_715369");
  $('#usage-six-months-chart').textContent = t("ui.henter_forbrug_db4b60"); $('#usage-six-months-total').textContent = '';
  $('#consumption-grams').focus();
  try {
    const entries = await request(`/api/filaments/${id}/consumption`);
    if (consumptionSpoolId !== id) return;
    renderRecentUsage(entries);
    $('#consumption-history').innerHTML = entries.length ? entries.map(entry => `<div class="usage-entry"><strong>${number(entry.grams)} g</strong><time>${esc(new Date(entry.created_at.replace(' ', 'T') + 'Z').toLocaleString(getLocale()))}</time><p>${esc(entry.note)}</p></div>`).join('') : `<p>${th("ui.intet_forbrug_registreret_endnu_f33820")}</p>`;
  } catch (error) { if (consumptionSpoolId === id) { $('#consumption-history').textContent = error.message; $('#usage-six-months-chart').textContent = t("ui.forbrugsgrafen_kunne_ikke_hentes_a793f0"); } }
}
function renderRecentUsage(entries) {
  const months = recentMonthlyUsage(entries);
  const max = Math.max(...months.map(month => month.grams),1);
  $('#usage-six-months-total').textContent = t("ui.kg_i_alt_af7254", {p0: number(months.reduce((sum,month) => sum+month.grams,0)/1000,3)});
  $('#usage-six-months-chart').innerHTML = `<ol class="usage-columns">${months.map(month => `<li aria-label="${th("ui.gram_0f3532", {p0: esc(month.label), p1: number(month.grams)})}"><span class="usage-column-value">${number(month.grams)} g</span><span class="usage-column-track" aria-hidden="true"><span style="height:${month.grams/max*100}%"></span></span><span class="usage-column-month">${esc(month.label)}</span></li>`).join('')}</ol>`;
}
function updateUsageFilterOptions() {
  const materials = new Map(), spools = new Map();
  for (const entry of usageState.entries) {
    materials.set(normalizeUsageText(entry.material), entry.material || t("ui.ikke_angivet_898bb9"));
    spools.set(String(entry.filament_id), `#${entry.filament_id} · ${entry.name} · ${entry.material} · ${entry.color || ''}`);
  }
  function options(selector, values, placeholder) {
    const node = $(selector), selected = node.value;
    node.innerHTML = `<option value="">${placeholder}</option>` + [...values].sort((a,b) => a[1].localeCompare(b[1],getLocale(),{numeric:true})).map(([value,label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    node.value = values.has(selected) ? selected : '';
  }
  options('#usage-material',materials,t("ui.alle_materialer_4b987d"));
  options('#usage-spool',spools,t("ui.alle_spoler_509c8f"));
}
const usageFilterSelectors = ['#usage-search','#usage-from','#usage-to','#usage-material','#usage-spool'];
function renderUsageHistory() {
  const filters = {query:$('#usage-search').value, from:$('#usage-from').value, to:$('#usage-to').value, material:$('#usage-material').value, spool:$('#usage-spool').value};
  const groups = sortUsageGroups(filterUsageGroups(usageState.entries, filters), $('#usage-sort').value || 'date', $('#usage-direction').value || 'desc');
  const total = groups.reduce((sum,group) => sum+group.grams,0);
  $('#usage-total').textContent = t("ui.kg_registreret_registreringer_031506", {p0: number(total / 1000, 3), p1: groups.length});
  $('#usage-filter-total').textContent = filters.from && filters.to && filters.from > filters.to ? t("ui.fra_dato_skal_vaere_foer_eller_lig_med_til_dato_1fdd75") : t("ui.af_registreringer_g_i_resultatet_e67fc2", {p0: groups.length, p1: groupUsage(usageState.entries).length, p2: number(total)});
  $('#usage-list').innerHTML = groups.length ? groups.map(group => {
    const entry = group.entry;
    if (group.waste) return `<article class="usage-record"><div><strong>${th("ui.spild_60336a", {p0: esc(wasteReasons[entry.waste_reason] || t("ui.andet_spild_26668b"))})}</strong><time>${th("ui.spoler_1b49fc", {p1: esc(entry.waste_date), p2: group.items.length})}</time>${entry.linked_project_name ? `<p>${th("ui.print_380d8b", {p0: esc(entry.linked_project_name)})}</p>` : ''}<p>${esc(entry.waste_note)}</p><details><summary>${th("ui.vis_forbrug_pr_spole_4b0f55")}</summary>${group.items.map(item => `<p>${esc(item.name)} · ${esc(item.material)}: <b>${number(item.grams)} g</b></p>`).join('')}</details></div><div class="usage-record-action"><b>${number(group.grams)} g</b><button data-edit-waste="${entry.waste_id}">${th("ui.rediger_spild_89ed48")}</button><button class="danger" data-delete-waste="${entry.waste_id}">${th("ui.slet_spild_106f4b")}</button></div></article>`;
    if (!group.project) return `<article class="usage-record"><div><strong>${esc(entry.name)} · ${esc(entry.material)}</strong><small>${esc(entry.manufacturer)} · ${esc(entry.color || '')}</small><time>${esc(new Date(entry.created_at.replace(' ', 'T') + 'Z').toLocaleString(getLocale()))}</time><p>${esc(entry.note)}</p></div><div class="usage-record-action"><b>${number(entry.grams)} g</b><button data-delete-usage="${entry.id}" class="danger">${th("ui.slet_forbrug_bebf35")}</button></div></article>`;
    return `<article class="usage-record" data-edit-print="${entry.print_id}" tabindex="0" aria-label="${th("ui.rediger_print_584172", {p1: esc(entry.project_name)})}"><div>${entry.has_image ? `<a href="/api/prints/${entry.print_id}/image" target="_blank" rel="noopener"><img class="print-thumbnail" src="/api/prints/${entry.print_id}/image" alt="${th("ui.billede_af_e72c4a", {p2: esc(entry.project_name)})}" loading="lazy"></a>` : ''}<strong>${esc(entry.project_name)}</strong><span class="print-status ${entry.print_status === 'failed' ? 'failed' : entry.print_status === 'in_progress' ? 'in-progress' : entry.print_status === 'pending' ? 'pending' : 'completed'}">${entry.print_status === 'failed' ? th("ui.fejlet_2c98b9") : entry.print_status === 'in_progress' ? th("ui.igangvaerende_11ccd3") : entry.print_status === 'pending' ? th("ui.afventer_ecd979") : th("ui.gennemfoert_183bb5")}</span><time>${th("ui.spoler_printtid_9f27e0", {p6: esc(entry.print_date), p7: group.items.length, p8: esc(formatPrintTime(entry.duration_minutes))})}</time><p>${esc(entry.project_note)}</p><details><summary>${th("ui.vis_forbrug_pr_spole_4b0f55")}</summary>${group.items.map(item => `<p>${esc(item.name)} · ${esc(item.material)} · ${esc(item.color || '')}: <b>${number(item.grams)} g</b></p>`).join('')}</details></div><div class="usage-record-action"><b>${number(group.grams)} g</b><button data-delete-print="${entry.print_id}" class="danger">${th("ui.slet_print_f7524c")}</button></div></article>`;
  }).join('') : `<p>${usageState.entries.length ? th("ui.ingen_registreringer_matcher_filtrene_c0779f") : th("ui.intet_materialeforbrug_registreret_endnu_ba09d7")}</p>`;
}

function initConsumption() {
  $('#usage-list').addEventListener('error', event => {
    if (event.target.matches('.print-thumbnail')) {
      const link = event.target.closest('a');
      if (link) link.hidden = true;
    }
  }, true);
  $('#consumption-spool').onchange = refreshConsumptionSpool;
  $('#quick-consume').onclick = () => openConsumption();
  $('#active-spools').onclick = event => { const button = event.target.closest('[data-consume]'); if(button) openConsumption(Number(button.dataset.consume)); };
  $('#consumption-close').onclick = $('#consumption-cancel').onclick = () => { consumptionSpoolId = null; $('#consumption-dialog').close(); };
  $('#consumption-form').onsubmit = async event => {
    event.preventDefault();
    $('#consumption-save').disabled = true;
    $('#consumption-spool').disabled = true;
    $('#consumption-error').textContent = '';
    try {
      await request(`/api/filaments/${consumptionSpoolId}/consumption`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({grams: Number($('#consumption-grams').value), note: $('#consumption-note').value})});
      try { localStorage.setItem('last-consumption-spool', String(consumptionSpoolId)); } catch {}
      $('#consumption-dialog').close();
      consumptionSpoolId = null;
      await Promise.all([load(), loadUsage()]);
      notify(t("ui.forbrug_registreret_restvaegten_er_opdateret_b0cc94"));
    } catch (error) { $('#consumption-error').textContent = error.message; }
    finally { $('#consumption-save').disabled = false; $('#consumption-spool').disabled = false; }
  };
  for (const selector of usageFilterSelectors) $(selector).addEventListener('input', renderUsageHistory);
  $('#usage-reset').onclick = () => { for (const selector of usageFilterSelectors) $(selector).value = ''; $('#usage-sort').value = 'date'; $('#usage-direction').value = 'desc'; renderUsageHistory(); };
  for (const selector of ['#usage-sort','#usage-direction']) $(selector).addEventListener('input',renderUsageHistory);
  $('#usage-list').onkeydown = event => {
    if (!['Enter', ' '].includes(event.key) || !event.target.matches('[data-edit-print]')) return;
    event.preventDefault(); event.target.click();
  };
  $('#usage-list').onclick = async event => {
    const wasteButton = event.target.closest('[data-edit-waste], [data-delete-waste]');
    if (wasteButton) {
      const deleting = wasteButton.dataset.deleteWaste;
      if (deleting && !confirm(t("ui.slet_hele_spildregistreringen_vaegten_laegges_ti_3b6e63"))) return;
      wasteButton.disabled = true;
      try {
        if (deleting) { await request(`/api/waste/${deleting}`,{method:'DELETE'}); await Promise.all([load(),loadUsage()]); notify(t("ui.spild_slettet_og_vaegten_er_gendannet_83950d")); }
        else await PrintEditor.openWaste(Number(wasteButton.dataset.editWaste));
      } catch(error) { $('#usage-error').textContent = error.message; }
      finally { wasteButton.disabled = false; }
      return;
    }
    const editButton = event.target.closest('button, a, details, input, select, textarea') ? null : event.target.closest('[data-edit-print]');
    if (editButton) {
      if (editButton.dataset.opening) return;
      editButton.dataset.opening = 'true';
      try { await PrintEditor.open(Number(editButton.dataset.editPrint)); }
      catch(error) { $('#usage-error').textContent = error.message; }
      finally { delete editButton.dataset.opening; }
      return;
    }
    const printButton = event.target.closest('[data-delete-print]');
    if (printButton) {
      if (!confirm(t("ui.slet_hele_printet_forbruget_laegges_tilbage_paa__ba1cef"))) return;
      printButton.disabled = true;
      try { await request(`/api/prints/${printButton.dataset.deletePrint}`, {method:'DELETE'}); await Promise.all([load(),loadUsage()]); notify(t("ui.printet_er_slettet_og_vaegten_er_gendannet_afa4c5")); }
      catch(error) { $('#usage-error').textContent = error.message; }
      finally { printButton.disabled = false; }
      return;
    }
    const button = event.target.closest('[data-delete-usage]');
    if (!button) return;
    const entry = usageState.entries.find(item => item.id === Number(button.dataset.deleteUsage));
    if (!entry || !confirm(t("ui.slet_registreringen_paa_g_vaegten_laegges_tilbag_defa4f", {p0: number(entry.grams), p1: entry.name}))) return;
    button.disabled = true;
    try {
      await request(`/api/consumption/${entry.id}`, {method: 'DELETE'});
      await Promise.all([load(), loadUsage()]);
      notify(t("ui.forbruget_er_slettet_og_restvaegten_er_gendannet_88c877"));
    } catch (error) { $('#usage-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
}

export { initConsumption, openConsumption, renderUsageHistory, updateUsageFilterOptions };
