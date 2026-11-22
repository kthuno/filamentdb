import { t, th } from './i18n.js';
import { $, compareLocations, esc, productLink, request } from './core.js';
import { inventoryState } from './inventory-data.js';
import qrcodegen from './vendor/qrcodegen.js';
import { thermalLabel, labelPng } from './thermal-labels.js';
// QR label rendering, selection and print lifecycle.
function spoolLink(spool) {
  const url = new URL(window.location.href);
  url.hash = `spool/${spool.label_token}`;
  return url.href;
}
function qrSvg(text) {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const paths = [];
  for(let y=0;y<qr.size;y++) for(let x=0;x<qr.size;x++) if(qr.getModule(x,y)) paths.push(`M${x+4},${y+4}h1v1h-1z`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.size+8} ${qr.size+8}" role="img" aria-label="${th("ui.qr_kode_til_spolen_5648fb")}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${paths.join(' ')}" fill="black"/></svg>`;
}
function labelDetails(spool) {
  return {
    title: spool.name,
    info: `${spool.manufacturer} · ${spool.color || t("ui.ingen_farve_609297")}`,
    productId: spool.product_id ? t("ui.produkt_id_ed128a", {p0: spool.product_id}) : t("ui.produkt_id_ikke_angivet_ded38a"),
  };
}
function labelMaterial(spool) {
  const color = /^#[0-9a-f]{6}$/i.test(spool.color_hex) ? spool.color_hex : '#282a36';
  return `<strong class="label-material" style="--label-color:${color}">${esc(spool.material)}</strong>`;
}
let labelRecords = [];
let selectedLabelIds = new Set();
let currentLabelSpool = null;
let currentThermalLabel = null;
let currentLabelProfile = null;
let labelLookupVersion = 0;
let dirtyLabelFields = new Set();
function profileRange(values,unit) {
  return `${values[0]}${values[0]===values[1]?'':`–${values[1]}`}${unit}`;
}
function selectedProfileDrying() {
  return currentLabelProfile?.drying_conditions[Number($('#thermal-drying-method').value || 0)];
}
function applyProfileField(field,value,force=false) {
  if(force || (!dirtyLabelFields.has(field) && !$('#thermal-'+field).value))$('#thermal-'+field).value=value;
}
function applyProfileDrying(force=false) {
  const condition=selectedProfileDrying();
  if(!condition)return;
  applyProfileField('drying',`${profileRange(condition.temperature_c,'°C')}/${profileRange(condition.hours,'h')}`,force);
  const notes=[];
  if(condition.method==='printer_heatbed')notes.push(t('labels.heatbed_drying_note'));
  if(['PPS-CF','PPA-CF'].includes(currentLabelProfile.material) && condition.method==='blast_oven')notes.push(t('labels.high_temp_drying_note'));
  if(currentLabelProfile.material==='PPS-CF' && condition.method==='printer_heatbed')notes.push(t('labels.less_effective_drying_note'));
  $('#thermal-drying-note').textContent=notes.join(' ');
}
function applyProfileBed(force=false) {
  const plate=currentLabelProfile?.bed_temperatures[Number($('#thermal-plate').value || 0)];
  if(plate)applyProfileField('bed',profileRange(plate.temperature_c,'°C'),force);
}
async function loadLabelProfile(spool,version) {
  if(!/^bambu(?:\s*lab)?$/i.test(String(spool.manufacturer || '').trim())) {
    $('#thermal-guide-status').textContent=t('labels.no_profile');
    return;
  }
  $('#thermal-guide-status').textContent=t('labels.loading_profile');
  try {
    const params=new URLSearchParams({manufacturer:spool.manufacturer,material:spool.material});
    const profile=await request('/api/material-profiles?'+params);
    if(version!==labelLookupVersion)return;
    currentLabelProfile=profile;
    if(!profile) {
      $('#thermal-guide-status').textContent=t('labels.no_profile');
      return;
    }
    $('#thermal-plate').innerHTML=profile.bed_temperatures.map((plate,index)=>`<option value="${index}">${esc(plate.plate)} · ${esc(profileRange(plate.temperature_c,'°C'))}</option>`).join('');
    const textured=profile.bed_temperatures.findIndex(plate=>plate.plate==='Textured PEI Plate');
    $('#thermal-plate').value=String(Math.max(0,textured));
    $('#thermal-drying-method').innerHTML=profile.drying_conditions.map((condition,index)=>`<option value="${index}">${esc(condition.method==='blast_oven'?t('labels.drying_method_blast_oven'):t('labels.drying_method_printer_heatbed'))}</option>`).join('');
    $('#thermal-drying-method').value='0';
    $('#thermal-guide-source').href=productLink(profile.source_url);
    $('#thermal-guide-controls').hidden=false;
    $('#thermal-guide-status').textContent=t('labels.profile_found',{material:profile.material});
    applyProfileField('nozzle',profileRange(profile.nozzle_temperature_c,'°C'));
    applyProfileBed();
    applyProfileDrying();
    if(profile.flow_ratio!=null)applyProfileField('flow',String(profile.flow_ratio));
    $('#thermal-flow-note').textContent=profile.flow_ratio==null?t('labels.flow_not_in_guide'):'';
    refreshThermalLabel();
  } catch {
    if(version!==labelLookupVersion)return;
    $('#thermal-guide-status').textContent=t('labels.profile_error');
  }
}
function thermalOptions() {
  return {
    size: $('#thermal-size').value || '60x40',
    layout: $('#thermal-layout').value || 'extended',
    nozzle: $('#thermal-nozzle').value,
    bed: $('#thermal-bed').value,
    flow: $('#thermal-flow').value,
    drying: $('#thermal-drying').value,
  };
}
function refreshThermalLabel() {
  if(!currentLabelSpool)return;
  const options=thermalOptions();
  const thermal=options.layout!=='classic';
  $('#label-dialog').classList.toggle('thermal-label-active',thermal);
  $('#legacy-label').hidden=thermal;
  $('#thermal-preview').hidden=!thermal;
  $('#thermal-settings').hidden=!thermal;
  $('#thermal-download').hidden=!thermal;
  $('#thermal-hint').hidden=!thermal;
  $('#thermal-quality').hidden=!thermal;
  $('#thermal-filetype-field').hidden=!thermal;
  $('#label-error').textContent='';
  currentThermalLabel=null;
  $('#thermal-preview').innerHTML='';
  $('#thermal-download').disabled=true;
  $('#label-print').disabled=false;
  if(!thermal)return;
  try {
    currentThermalLabel=thermalLabel(currentLabelSpool,spoolLink(currentLabelSpool),options);
    $('#thermal-preview').innerHTML=currentThermalLabel.svg;
    $('#thermal-download').disabled=false;
    $('#thermal-page-style').textContent=`@media print { @page thermal-label { size: ${currentThermalLabel.mmWidth}mm ${currentThermalLabel.mmHeight}mm; margin: 0; } }`;
    $('#thermal-quality').textContent=currentThermalLabel.moduleDots<3?t('labels.small_qr'):'';
  } catch(error) {
    $('#label-error').textContent=error.message;
    $('#label-print').disabled=true;
    $('#thermal-quality').textContent='';
  }
}
async function downloadThermalLabel() {
  if(!currentThermalLabel || !currentLabelSpool)return;
  const label=currentThermalLabel;
  const description=[currentLabelSpool.material,currentLabelSpool.color]
    .filter(Boolean).join('-').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^[.-]+|[.-]+$/g,'');
  const filename=`filament-${description || currentLabelSpool.id}-${thermalOptions().layout}-${thermalOptions().size}`;
  const format=$('#thermal-filetype').value || 'png';
  $('#thermal-download').disabled=true;
  $('#label-error').textContent='';
  let url;
  try {
    const blob=format==='svg' ? new Blob([label.svg],{type:'image/svg+xml;charset=utf-8'}) : await labelPng(label);
    url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url; anchor.download=`${filename}.${format}`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    // Give mobile browsers time to start saving before releasing the URL.
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  } catch {
    if(url)URL.revokeObjectURL(url);
    $('#label-error').textContent=t('labels.download_error');
  } finally { $('#thermal-download').disabled=!currentThermalLabel; }
}
function labelPages(records, selectable=false) {
  const pages = [];
  for (let offset = 0; offset < records.length; offset += 9) {
    const labels = records.slice(offset,offset+9).map(spool => {
      const details = labelDetails(spool);
      return `<article class="sheet-label">${selectable ? `<label class="label-choice"><input type="checkbox" data-label-spool="${spool.id}" ${selectedLabelIds.has(spool.id) ? 'checked' : ''} aria-label="${th("ui.udskriv_label_til_spole_fe6772", {p2: esc(details.title), p3: spool.id})}"><span>${th("ui.spole_c5f792", {p4: spool.id, p5: esc(spool.location || t("ui.ingen_placering_96a4dd"))})}</span></label>` : ''}${labelMaterial(spool)}<h3>${esc(details.title)}</h3><p>${esc(details.info)}</p><div class="sheet-qr">${qrSvg(spoolLink(spool))}</div><p>${esc(details.productId)}</p></article>`;
    }).join('');
    pages.push(`<section class="label-sheet" aria-label="${th("ui.side_37bbff", {p0: pages.length+1})}">${labels}</section>`);
  }
  return pages.join('');
}
function updateLabelSelection() {
  const selected = labelRecords.filter(spool => selectedLabelIds.has(spool.id));
  $('#all-labels-error').textContent = '';
  $('#selected-labels-pages').innerHTML = '';
  $('#all-labels-print').disabled = true;
  $('#all-labels-summary').textContent = !labelRecords.length ? t("ui.ingen_spoler_i_arkivet_endnu_d9f267") : !selected.length ? t("ui.ingen_labels_valgt_0_af_valgt_7f1b3e", {p0: labelRecords.length}) : t("ui.labels_9_labels_pr_side_af_valgt_140637", {p0: selected.length, p1: Math.ceil(selected.length/9), p2: selected.length > 9 ? t("ui.sider_ff2400") : t("ui.side_ea7bf4"), p3: selected.length, p4: labelRecords.length});
  try {
    $('#selected-labels-pages').innerHTML = labelPages(selected);
    $('#all-labels-print').disabled = selected.length === 0;
  } catch { $('#all-labels-error').textContent = t("ui.qr_labels_kunne_ikke_genereres_proev_at_genindla_574038"); }
}
function renderLabelChoices() {
  $('#all-labels-pages').innerHTML = '';
  $('#selected-labels-pages').innerHTML = '';
  $('#all-labels-print').disabled = true;
  try {
    $('#all-labels-pages').innerHTML = labelPages(labelRecords,true);
    updateLabelSelection();
  } catch { $('#all-labels-error').textContent = t("ui.qr_labels_kunne_ikke_genereres_proev_at_genindla_574038"); }
}
function showAllLabels() {
  labelRecords = [...inventoryState.spools].sort(compareLocations);
  selectedLabelIds = new Set(labelRecords.map(spool => spool.id));
  $('#all-labels-error').textContent = '';
  $('#all-labels-select-all').disabled = $('#all-labels-deselect-all').disabled = labelRecords.length === 0;
  renderLabelChoices();
  $('#all-labels-panel').hidden = false;
  $('#all-labels-open').setAttribute('aria-expanded','true');
}
function prepareLabelPrinting() {
  $('#selected-labels-pages').dataset.printActive = String(!$('#qr-labels-view').hidden && !$('#all-labels-panel').hidden && !$('#label-dialog').open);
}
function openLabel(id) {
  const spool = inventoryState.spools.find(s => s.id === id);
  if (!spool) return;
  const version=++labelLookupVersion;
  currentLabelSpool=spool;
  currentLabelProfile=null;
  dirtyLabelFields=new Set();
  $('#thermal-guide-controls').hidden=true;
  $('#thermal-flow-note').textContent='';
  $('#thermal-drying-note').textContent='';
  $('#thermal-nozzle').value=Number(spool.nozzle_temp)>0?`${spool.nozzle_temp}°C`:'';
  $('#thermal-bed').value=Number(spool.bed_temp)>0?`${spool.bed_temp}°C`:'';
  $('#thermal-flow').value='';
  $('#thermal-drying').value='';
  const link = spoolLink(spool);
  const details = labelDetails(spool);
  $('#label-material').innerHTML = labelMaterial(spool);
  $('#label-title').textContent = details.title;
  $('#label-info').textContent = details.info;
  $('#label-id').textContent = details.productId;
  $('#label-link').value = link;
  $('#label-error').textContent = '';
  try { $('#label-qr').innerHTML = qrSvg(link); }
  catch { $('#label-error').textContent = t("ui.qr_koden_kunne_ikke_genereres_brug_det_direkte_l_20f00b"); $('#label-qr').innerHTML = ''; }
  refreshThermalLabel();
  $('#label-dialog').showModal();
  return loadLabelProfile(spool,version);
}

function initLabels() {
  $('#thermal-layout').onchange=refreshThermalLabel;
  $('#thermal-size').onchange=refreshThermalLabel;
  for(const field of ['nozzle','bed','flow','drying'])$('#thermal-'+field).oninput=()=>{dirtyLabelFields.add(field);refreshThermalLabel();};
  $('#thermal-plate').onchange=()=>{applyProfileBed(true);refreshThermalLabel();};
  $('#thermal-drying-method').onchange=()=>{applyProfileDrying(true);refreshThermalLabel();};
  $('#thermal-use-guide').onclick=()=>{
    if(!currentLabelProfile)return;
    applyProfileField('nozzle',profileRange(currentLabelProfile.nozzle_temperature_c,'°C'),true);
    applyProfileBed(true);applyProfileDrying(true);
    if(currentLabelProfile.flow_ratio!=null)applyProfileField('flow',String(currentLabelProfile.flow_ratio),true);
    refreshThermalLabel();
  };
  $('#thermal-download').onclick=downloadThermalLabel;
  $('#all-labels-pages').onchange = event => {
    const checkbox = event.target.closest('[data-label-spool]');
    if (!checkbox) return;
    const id = Number(checkbox.dataset.labelSpool);
    if (!labelRecords.some(spool => spool.id === id)) return;
    if (checkbox.checked) selectedLabelIds.add(id); else selectedLabelIds.delete(id);
    updateLabelSelection();
  };
  $('#all-labels-select-all').onclick = () => { selectedLabelIds = new Set(labelRecords.map(spool => spool.id)); renderLabelChoices(); };
  $('#all-labels-deselect-all').onclick = () => { selectedLabelIds.clear(); renderLabelChoices(); };
  $('#all-labels-open').onclick = showAllLabels;
  window.addEventListener('beforeprint',prepareLabelPrinting);
  window.addEventListener('afterprint',() => { $('#selected-labels-pages').dataset.printActive = 'false'; });
  $('#all-labels-print').onclick = () => {
    if ($('#all-labels-print').disabled) return;
    prepareLabelPrinting();
    window.print();
  };
  $('#label-close').onclick = () => $('#label-dialog').close();
  $('#label-copy').onclick = async () => { try { await navigator.clipboard.writeText($('#label-link').value); $('#label-error').textContent = t("ui.link_kopieret_69dfad"); } catch { $('#label-link').select(); $('#label-error').textContent = t("ui.marker_og_kopier_linket_manuelt_5b1e3d"); } };
  $('#label-print').onclick = () => window.print();
}

export { initLabels, openLabel };
