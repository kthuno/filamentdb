import { t, th, getLocale } from './i18n.js';
import { edit, load } from './actions.js';
import { $, compareLocationNames, esc, notify, number, request } from './core.js';
import { inventoryState } from './inventory-data.js';
// Location views, free capacity and spool placement fields.
const locationKind = kind => ({box:t("ui.boks_toerboks_226350"),ams_ht:t("ui.ams_ht_6f1d4d"),ams_2_pro:t("ui.ams_2_pro_b67f43")}[kind]);
function locationLabel(place, slot) { return place.kind === 'ams_2_pro' ? t("ui.slot_1d3432", {p0: place.name, p1: slot}) : place.name; }
function populateLocations(id) {
  const current = inventoryState.spools.find(s => s.id === id);
  $('#location-picker').innerHTML = `<option value="">${th("ui.manuel_placering_ingen_placering_a9b444")}</option>` + inventoryState.locations.map(place => Array.from({length:place.kind === 'ams_2_pro' ? 4 : 1}, (_,i) => {
    const slot = i+1;
    const occupied = inventoryState.spools.some(s => s.id !== id && s.location_id === place.id && s.location_slot === slot);
    return `<option value="${place.id}:${slot}" ${occupied ? 'disabled' : ''}>${esc(locationLabel(place,slot))}${occupied ? th("ui.optaget_455641") : ''}</option>`;
  }).join('')).join('');
  $('#location-picker').value = current?.location_id ? `${current.location_id}:${current.location_slot}` : '';
  if ($('#form').elements.active_slot.dataset) $('#form').elements.active_slot.dataset.managed = 'false';
  syncLocationFields();
}
function syncLocationFields() {
  const form = $('#form');
  const selected = $('#location-picker').value;
  const [id,slot] = selected.split(':').map(Number);
  const place = inventoryState.locations.find(p => p.id === id);
  const active = form.elements.active_slot;
  if (active.dataset?.managed === 'true') active.value = '';
  const managed = ['ams_2_pro','ams_ht'].includes(place?.kind);
  if (managed) active.value = Number(form.elements.remaining.value) > 0 ? locationLabel(place,slot) : '';
  active.disabled = managed;
  // dataset is also used to clear the derived value when moving off the AMS.
  if (active.dataset) active.dataset.managed = String(managed);
  $('#active-slot-field').hidden = managed;
  form.elements.location.disabled = Boolean(selected);
}
function renderAmsLocation(place) {
  const count = place.kind === 'ams_2_pro' ? 4 : 1;
  const occupants = Array.from({length:count}, (_,index) => inventoryState.spools.find(spool => spool.location_id === place.id && spool.location_slot === index+1));
  const occupied = occupants.filter(Boolean).length;
  return `<article id="location-${place.id}" data-select-location="${place.id}" class="location-record ams-device${occupied ? '' : ' location-available'}" tabindex="-1"><div class="ams-device-header"><div class="ams-device-title"><span class="ams-device-icon" aria-hidden="true">${`<i></i>`.repeat(count)}</span><div><span class="ams-model">${esc(locationKind(place.kind))}</span><h3>${esc(place.name)}</h3></div></div><span class="ams-capacity">${th("ui.pladser_optaget_aef793", {p6: occupied, p7: count})}</span></div><div class="ams-slots${count === 1 ? ' ams-single' : ''}">${occupants.map((spool,index) => {
    const color = spool && /^#[0-9a-f]{6}$/i.test(spool.color_hex) ? spool.color_hex : '#bd93f9';
    const percent = spool ? Math.max(0,Math.min(100,spool.remaining/spool.weight*100 || 0)) : 0;
    const content = `<span class="ams-slot-top"><span>${th("ui.slot_15ba7f", {p0: index+1})}</span><span class="ams-slot-state">${!spool ? th("ui.ledig_e5fe00") : spool.remaining > 0 ? th("ui.i_brug_460df7") : th("ui.tom_spole_f9d5ba")}</span></span><span class="ams-reel${spool ? '' : ' ams-reel-empty'}${spool?.transparency === 'transparent' ? ' ams-reel-transparent' : ''}" aria-hidden="true"></span><span class="ams-slot-name">${spool ? esc(spool.name) : th("ui.plads_til_en_spole_01a297")}</span><span class="ams-slot-detail">${spool ? `${esc(spool.material)} · ${esc(spool.color || t("ui.ingen_farve_angivet_930385"))}` : th("ui.klar_til_naeste_filament_33bec4")}</span>${spool ? `<span class="ams-slot-weight">${number(spool.remaining)} <small>${th("ui.g_d5ad14", {p1: number(spool.weight)})}</small></span><span class="ams-slot-bar" aria-hidden="true"><span style="width:${percent}%"></span></span><span class="ams-slot-hint">${th("ui.vaelg_spole_4aa198")}</span>` : `<span class="ams-slot-hint">${th("ui.vaelg_spole_4aa198")}</span>`}`;
    return `<div class="ams-slot-container"><button type="button" class="ams-slot${!spool ? ' ams-slot-vacant' : spool.remaining > 0 ? '' : ' ams-slot-depleted'}" style="--filament:${color}" data-select-location="${place.id}" data-select-slot="${index+1}" aria-label="${th("ui.vaelg_spole_til_8c6260", {p4: esc(locationLabel(place,index+1))})}">${content}</button>${spool ? `<button type="button" class="location-spool-edit" data-open-spool="${spool.id}">${th("ui.rediger_spole_812e98")}</button>` : ''}</div>`;
  }).join('')}</div><div class="location-actions ams-device-actions"><button data-edit-location="${place.id}">${th("ui.rediger_placering_0e2bb7")}</button><button class="danger" data-delete-location="${place.id}">${th("ui.slet_b9f4c0")}</button></div></article>`;
}
function renderDryBoxLocation(place) {
  const spool = inventoryState.spools.find(item => item.location_id === place.id && item.location_slot === 1);
  const color = spool && /^#[0-9a-f]{6}$/i.test(spool.color_hex) ? spool.color_hex : '#bd93f9';
  const percent = spool ? Math.max(0,Math.min(100,spool.remaining/spool.weight*100 || 0)) : 0;
  const visual = `<span class="drybox-visual" aria-hidden="true"><span class="drybox-lid"></span><span class="drybox-container"><span class="ams-reel${spool ? '' : ' ams-reel-empty'}${spool?.transparency === 'transparent' ? ' ams-reel-transparent' : ''}"></span><span class="drybox-grip"></span></span><span class="drybox-foot"></span></span>`;
  const content = `${visual}<span class="drybox-content"><span class="ams-slot-top"><span>${th("ui.spoleplads_dc1c8c")}</span><span class="ams-slot-state">${!spool ? th("ui.ledig_e5fe00") : spool.remaining > 0 ? th("ui.paa_lager_633729") : th("ui.tom_spole_f9d5ba")}</span></span><span class="ams-slot-name">${spool ? esc(spool.name) : th("ui.klar_til_naeste_spole_6ccb68")}</span><span class="ams-slot-detail">${spool ? `${esc(spool.manufacturer || '')} · ${esc(spool.material)} · ${esc(spool.color || t("ui.ingen_farve_angivet_930385"))}` : th("ui.vaelg_en_spole_til_boksen_9d4d45")}</span>${spool ? `<span class="ams-slot-weight">${number(spool.remaining)} <small>${th("ui.g_d5ad14", {p1: number(spool.weight)})}</small></span><span class="ams-slot-bar" aria-hidden="true"><span style="width:${percent}%"></span></span><span class="ams-slot-hint">${th("ui.vaelg_spole_4aa198")}</span>` : `<span class="drybox-empty-note">${th("ui.1_ledig_plads_26e4d2")}</span>`}</span>`;
  return `<article id="location-${place.id}" data-select-location="${place.id}" class="location-record ams-device drybox-device${spool ? '' : ' location-available'}" tabindex="-1"><div class="ams-device-header"><div class="ams-device-title"><span class="drybox-icon" aria-hidden="true"></span><div><span class="ams-model">${th("ui.toerboks_1_spole_f545b4")}</span><h3>${esc(place.name)}</h3></div></div><span class="ams-capacity">${spool ? th("ui.1_1_plads_optaget_adbea2") : th("ui.0_1_plads_optaget_728267")}</span></div><button type="button" class="drybox-slot${spool ? (spool.remaining > 0 ? '' : ' ams-slot-depleted') : ' drybox-vacant'}" style="--filament:${color}" data-select-location="${place.id}" data-select-slot="1" aria-label="${th("ui.vaelg_spole_til_4c4226", {p8: esc(place.name)})}">${content}</button><div class="location-actions ams-device-actions"> ${spool ? `<button type="button" class="location-spool-edit" data-open-spool="${spool.id}">${th("ui.rediger_spole_812e98")}</button>` : ''}<button data-edit-location="${place.id}">${th("ui.rediger_placering_0e2bb7")}</button><button class="danger" data-delete-location="${place.id}">${th("ui.slet_b9f4c0")}</button></div></article>`;
}
function renderLocations() {
  const available = [];
  let capacity = 0;
  for (const place of [...inventoryState.locations].sort((a,b) => compareLocationNames(a.name,b.name))) {
    const slots = place.kind === 'ams_2_pro' ? 4 : 1;
    capacity += slots;
    for (let slot = 1; slot <= slots; slot++) {
      if (!inventoryState.spools.some(s => s.location_id === place.id && s.location_slot === slot)) available.push({id:place.id,label:locationLabel(place,slot)});
    }
  }
  $('#available-locations-count').textContent = !capacity ? t("ui.ingen_placeringer_oprettet_endnu_96ad3b") : available.length ? t("ui.af_pladser_er_ledige_34bf48", {p0: available.length, p1: capacity}) : t("ui.alle_pladser_er_optaget_544326");
  $('#available-locations-list').innerHTML = available.map(place => `<li><button type="button" data-scroll-location="${place.id}">${esc(place.label)}</button></li>`).join('');
  $('#available-locations-list').hidden = available.length === 0;
  $('#location-list').innerHTML = inventoryState.locations.map(place => place.kind === 'box' ? renderDryBoxLocation(place) : renderAmsLocation(place)).join('') || `<p>${th("ui.ingen_placeringer_endnu_opret_din_foerste_placer_6f311b")}</p>`;
}
function resetLocationForm() {
  $('#location-edit-id').value = ''; $('#location-name').value = ''; $('#location-kind').value = 'box';
  $('#location-form-heading').textContent = t("ui.opret_placering_376245");
  $('#location-save').textContent = t("ui.opret_placering_376245"); $('#location-cancel').hidden = true;
}

let contentBusy = false;
let contentLocationId = null;
let expectedContentId = null;
let contentOpenVersion = 0;
function contentOccupant() {
  return inventoryState.spools.find(spool => spool.location_id === contentLocationId && spool.location_slot === Number($('#location-content-slot').value));
}
function updateContentDescription() {
  const current=contentOccupant();
  const selectedId=$('#location-content-spool').value ? Number($('#location-content-spool').value) : null;
  const selected=inventoryState.spools.find(spool=>spool.id===selectedId);
  $('#location-content-current').textContent=current ? t("ui.nuvaerende_spole_g_609918", {p0: current.name, p1: current.material, p2: number(current.remaining)}) : t("ui.pladsen_er_ledig_37e725");
  const changes=[];
  if(current && current.id!==selectedId) changes.push(t("ui.den_nuvaerende_spole_flyttes_til_lager_ad7479"));
  if(selected && selected.id!==expectedContentId) changes.push(t("ui.den_valgte_spole_flyttes_fra_til_denne_plads_4d7fa2", {p0: selected.location || 'lager'}));
  $('#location-content-change').textContent=changes.join(' ');
  $('#location-content-save').disabled=contentBusy || selectedId===expectedContentId;
}
function renderContentOptions(selected = $('#location-content-spool').value) {
  const query=$('#location-content-search').value.trim().toLocaleLowerCase('da');
  const records=inventoryState.spools.filter(spool=>!spool.archived && (
    String(spool.id)===selected || [spool.id,spool.name,spool.manufacturer,spool.material,spool.color,spool.location].join(' ').toLocaleLowerCase('da').includes(query)
  )).sort((a,b)=>a.name.localeCompare(b.name,getLocale()) || a.id-b.id);
  $('#location-content-spool').innerHTML=`<option value="">${th("ui.ingen_spole_ryd_pladsen_455570")}</option>`+records.map(spool=>`<option value="${spool.id}">${th("ui.g_400a06", {p1: spool.id, p2: esc(spool.name), p3: esc(spool.material), p4: esc(spool.color || t("ui.ingen_farve_609297")), p5: number(spool.remaining), p6: esc(spool.location || t("ui.lager_378168"))})}</option>`).join('');
  $('#location-content-spool').value=selected;
  updateContentDescription();
}
function selectContentSlot() {
  $('#location-content-search').value='';
  expectedContentId=contentOccupant()?.id ?? null;
  renderContentOptions(expectedContentId == null ? '' : String(expectedContentId));
}
async function openLocationContents(identity, slot=null) {
  const version=++contentOpenVersion;
  await load();
  if(version!==contentOpenVersion) return;
  const place=inventoryState.locations.find(item=>item.id===identity);
  if(!place) throw new Error(t("ui.placeringen_findes_ikke_laengere_de1a67"));
  contentLocationId=identity;
  setContentBusy(false);
  const slots=Array.from({length:place.kind==='ams_2_pro'?4:1},(_,index)=>index+1);
  const initial=slots.includes(slot) ? slot : slots.find(value=>!inventoryState.spools.some(spool=>spool.location_id===identity && spool.location_slot===value)) || 1;
  $('#location-content-title').textContent=t("ui.vaelg_indhold_925a06")+place.name;
  $('#location-content-slot').innerHTML=slots.map(value=>`<option value="${value}">${esc(locationLabel(place,value))}</option>`).join('');
  $('#location-content-slot').value=String(initial);
  $('#location-content-slot-field').hidden=slots.length===1;
  $('#location-content-error').textContent='';
  selectContentSlot();
  if(!$('#location-content-dialog').open) $('#location-content-dialog').showModal();
  $('#location-content-search').focus();
}

function setContentBusy(busy) {
  contentBusy=busy;
  for(const selector of ['#location-content-slot','#location-content-spool','#location-content-search']) $(selector).disabled=busy;
}
function initLocations() {
  $('#location-content-close').onclick = $('#location-content-cancel').onclick = () => $('#location-content-dialog').close();
  $('#location-content-slot').onchange=selectContentSlot;
  $('#location-content-search').oninput=()=>renderContentOptions();
  $('#location-content-spool').onchange=updateContentDescription;
  $('#location-content-form').onsubmit=async event=>{
    event.preventDefault();
    if(contentBusy) return;
    const version=contentOpenVersion;
    setContentBusy(true);
    $('#location-content-save').disabled=true;
    $('#location-content-error').textContent='';
    try {
      await request(`/api/locations/${contentLocationId}/contents`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        slot:Number($('#location-content-slot').value),
        filament_id:$('#location-content-spool').value ? Number($('#location-content-spool').value) : null,
        expected_filament_id:expectedContentId,
      })});
    } catch(error) {
      if(version!==contentOpenVersion) return;
      setContentBusy(false);
      $('#location-content-error').textContent=error.message;
      updateContentDescription();
      return;
    }
    if(version===contentOpenVersion) { setContentBusy(false); $('#location-content-dialog').close(); }
    try { await load(); notify(t("ui.placeringens_indhold_er_opdateret_152603")); }
    catch(error) { notify(t("ui.indholdet_er_gemt_men_oversigten_kunne_ikke_opda_f12ed0")+error.message); }
  };
  $('#location-picker').onchange = syncLocationFields;
  $('#form').elements?.remaining?.addEventListener?.('input', syncLocationFields);
  $('#available-locations-list').onclick = event => {
    const button = event.target.closest('[data-scroll-location]');
    if (!button) return;
    const id = Number(button.dataset.scrollLocation);
    if (!inventoryState.locations.some(place => place.id === id)) return;
    const target = $('#location-'+id);
    target.focus({preventScroll:true});
    target.scrollIntoView({behavior:'smooth',block:'start'});
  };
  $('#location-cancel').onclick = resetLocationForm;
  $('#location-list').onclick = async event => {
    const spoolLink = event.target.closest('[data-open-spool]');
    if (spoolLink) {
      edit(Number(spoolLink.dataset.openSpool));
      return;
    }
    const locationEdit = event.target.closest('[data-edit-location]');
    if (locationEdit) {
      const place = inventoryState.locations.find(p => p.id === Number(locationEdit.dataset.editLocation));
      $('#location-edit-id').value = place.id; $('#location-name').value = place.name; $('#location-kind').value = place.kind;
      $('#location-form-heading').textContent = t("ui.rediger_placering_0e2bb7");
      $('#location-save').textContent = t("ui.gem_placering_b451ce"); $('#location-cancel').hidden = false; $('#location-name').focus();
      return;
    }
    const remove = event.target.closest('[data-delete-location]');
    if (remove) {
      if (!confirm(t("ui.vil_du_slette_placeringen_c66260"))) return;
      try { await request('/api/locations/'+remove.dataset.deleteLocation,{method:'DELETE'}); resetLocationForm(); await load(); $('#location-error').textContent = ''; }
      catch(error) { $('#location-error').textContent = error.message; }
      return;
    }
    const target=event.target.closest('[data-select-location]');
    if(target) {
      try { await openLocationContents(Number(target.dataset.selectLocation), Number(target.dataset.selectSlot) || null); }
      catch(error) { $('#location-error').textContent=error.message; }
    }
  };
  $('#location-form').onsubmit = async event => {
    event.preventDefault(); $('#location-error').textContent = ''; $('#location-save').disabled = true;
    const id = $('#location-edit-id').value;
    try {
      await request('/api/locations'+(id ? '/'+id : ''), {method:id ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#location-name').value,kind:$('#location-kind').value})});
      resetLocationForm(); await load(); notify(t("ui.placeringen_er_gemt_7f5670"));
    } catch(error) { $('#location-error').textContent = error.message; }
    finally { $('#location-save').disabled = false; }
  };
}

export { initLocations, populateLocations, renderLocations };
