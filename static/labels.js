import { t, th } from './i18n.js';
import { $, compareLocations, esc, productLink, request } from './core.js';
import { inventoryState } from './inventory-data.js';
import qrcodegen from './vendor/qrcodegen.js';
import { LABEL_SIZES, thermalLabel, labelPng } from './thermal-labels.js';
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
async function saveLabelImage(spool,label,options,format) {
  const description=[spool.material,spool.color]
    .filter(Boolean).join('-').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^[.-]+|[.-]+$/g,'');
  const filename=`filament-${description || spool.id}-${options.layout}-${options.size}.${format}`;
  const blob=format==='svg' ? new Blob([label.svg],{type:'image/svg+xml;charset=utf-8'}) : await labelPng(label);
  const url=URL.createObjectURL(blob);
  try {
    const anchor=document.createElement('a');
    anchor.href=url; anchor.download=filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
  } finally {
    // Give mobile browsers time to start saving before releasing the URL.
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
}
async function downloadThermalLabel() {
  if(!currentThermalLabel || !currentLabelSpool)return;
  $('#thermal-download').disabled=true;
  $('#label-error').textContent='';
  try {
    await saveLabelImage(currentLabelSpool,currentThermalLabel,thermalOptions(),$('#thermal-filetype').value || 'png');
  } catch {
    $('#label-error').textContent=t('labels.download_error');
  } finally { $('#thermal-download').disabled=!currentThermalLabel; }
}

let galleryVersion=0;
let galleryLabels=new Map();
function galleryDefaults(spool,profile) {
  const plate=profile?.bed_temperatures.find(item=>item.plate==='Textured PEI Plate') || profile?.bed_temperatures[0];
  const drying=profile?.drying_conditions[0];
  return {
    layout:'extended',size:'60x40',format:'png',
    nozzle:profile ? profileRange(profile.nozzle_temperature_c,'°C') : Number(spool.nozzle_temp)>0 ? `${spool.nozzle_temp}°C` : '',
    bed:plate ? profileRange(plate.temperature_c,'°C') : Number(spool.bed_temp)>0 ? `${spool.bed_temp}°C` : '',
    flow:profile?.flow_ratio!=null ? String(profile.flow_ratio) : '',
    drying:drying ? `${profileRange(drying.temperature_c,'°C')}/${profileRange(drying.hours,'h')}` : '',
  };
}
function galleryCard(entry) {
  const {spool,options}=entry;
  const fieldKeys={nozzle:'labels.nozzle',bed:'labels.bed',flow:'labels.flow',drying:'labels.drying'};
  const input=field=>`<label>${th(fieldKeys[field])}<input data-gallery-field="${field}" maxlength="80" value="${esc(options[field])}"></label>`;
  const select=(field,key,items)=>`<label>${th(key)}<select data-gallery-field="${field}">${items.map(([value,text])=>`<option value="${value}"${options[field]===value?' selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
  return `<article class="label-gallery-card" data-gallery-id="${spool.id}">
    <h3>${esc(spool.material)} · ${esc(spool.color || spool.name)}</h3>
    <p>${th('ui.spole_c5f792',{p4:spool.id,p5:esc(spool.location || t('ui.ingen_placering_96a4dd'))})}</p>
    <div class="gallery-preview"></div>
    <p class="gallery-status" role="status">${th('labels.loading_profile')}</p>
    <div class="thermal-controls">
      ${select('layout','labels.layout',[['extended',t('labels.extended')],['compact',t('labels.compact')]])}
      ${select('size','labels.size',Object.keys(LABEL_SIZES).map(size=>[size,size.replace('x',' × ')+' mm']))}
      ${['nozzle','bed','flow','drying'].map(input).join('')}
      ${select('format','labels.filetype',[['png',t('labels.png')],['svg',t('labels.svg')]])}
    </div>
    <p class="gallery-error" role="alert"></p>
    <div class="modal-actions"><button type="button" data-gallery-action="download">${th('labels.download')}</button>
    <button type="button" class="primary" data-gallery-action="print">${th('ui.print_label_a1aa7b')}</button></div>
  </article>`;
}
function refreshGalleryCard(card,entry) {
  const error=card.querySelector('.gallery-error');
  error.textContent='';
  entry.label=null;
  try {
    entry.label=thermalLabel(entry.spool,spoolLink(entry.spool),entry.options);
    card.querySelector('.gallery-preview').innerHTML=entry.label.svg;
  } catch(problem) {
    card.querySelector('.gallery-preview').innerHTML='';
    error.textContent=problem.message;
  }
  for(const button of card.querySelectorAll('[data-gallery-action]'))button.disabled=!entry.label;
}
async function showLabelGallery() {
  const version=++galleryVersion;
  const profiles=new Map();
  galleryLabels=new Map([...inventoryState.spools].sort(compareLocations).map(spool=>[spool.id,{
    spool,options:galleryDefaults(spool,null),dirty:new Set(),label:null,
  }]));
  const gallery=$('#label-gallery');
  gallery.innerHTML=[...galleryLabels.values()].map(galleryCard).join('');
  $('#label-gallery-status').textContent=galleryLabels.size ? t('labels.gallery_help') : t('ui.ingen_spoler_i_arkivet_endnu_d9f267');
  await Promise.all([...galleryLabels.values()].map(async entry=>{
    const card=gallery.querySelector(`[data-gallery-id="${entry.spool.id}"]`);
    refreshGalleryCard(card,entry);
    let profile=null,failed=false;
    try {
      if(/^bambu(?:\s*lab)?$/i.test(String(entry.spool.manufacturer || '').trim())) {
        const params=new URLSearchParams({manufacturer:entry.spool.manufacturer,material:entry.spool.material});
        const key=params.toString();
        if(!profiles.has(key))profiles.set(key,request('/api/material-profiles?'+params));
        profile=await profiles.get(key);
      }
    } catch { failed=true; }
    if(version!==galleryVersion)return;
    const defaults=galleryDefaults(entry.spool,profile);
    for(const field of ['nozzle','bed','flow','drying'])if(!entry.dirty.has(field)) {
      entry.options[field]=defaults[field];
      card.querySelector(`[data-gallery-field="${field}"]`).value=defaults[field];
    }
    card.querySelector('.gallery-status').textContent=failed ? t('labels.profile_error') : profile ? t('labels.profile_found',{material:profile.material}) : t('labels.no_profile');
    refreshGalleryCard(card,entry);
  }));
}
function editGalleryLabel(event) {
  const field=event.target.dataset.galleryField;
  const card=event.target.closest('[data-gallery-id]');
  const entry=card && galleryLabels.get(Number(card.dataset.galleryId));
  if(!entry || !Object.hasOwn(entry.options,field))return;
  entry.options[field]=event.target.value;
  entry.dirty.add(field);
  refreshGalleryCard(card,entry);
}
async function useGalleryLabel(event) {
  const button=event.target.closest('[data-gallery-action]');
  const card=button?.closest('[data-gallery-id]');
  const entry=card && galleryLabels.get(Number(card.dataset.galleryId));
  if(!entry?.label || button.disabled)return;
  if(button.dataset.galleryAction==='print') {
    openLabel(entry.spool.id);
    for(const field of ['layout','size','nozzle','bed','flow','drying'])$('#thermal-'+field).value=entry.options[field];
    dirtyLabelFields=new Set(['nozzle','bed','flow','drying']);
    refreshThermalLabel();
    window.print();
  } else {
    button.disabled=true;
    card.querySelector('.gallery-error').textContent='';
    try { await saveLabelImage(entry.spool,entry.label,entry.options,entry.options.format); }
    catch { card.querySelector('.gallery-error').textContent=t('labels.download_error'); }
    finally { button.disabled=!entry.label; }
  }
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
  $('#all-labels-panel').scrollIntoView?.({block:'nearest'});
}
function setLabelToggle(button,expanded,showKey,hideKey) {
  const key=expanded ? hideKey : showKey;
  button.setAttribute('aria-expanded',String(expanded));
  button.setAttribute('data-i18n-text','0:'+key);
  button.textContent=t(key);
}
function toggleAllLabels() {
  const panel=$('#all-labels-panel');
  const expanded=panel.hidden;
  if(expanded) {
    const spools=[...inventoryState.spools].sort(compareLocations);
    if(!labelRecords.length || spools.length!==labelRecords.length || spools.some((spool,index)=>spool!==labelRecords[index]))showAllLabels();
    else { panel.hidden=false; panel.scrollIntoView?.({block:'nearest'}); }
  } else {
    panel.hidden=true;
    $('#selected-labels-pages').dataset.printActive='false';
  }
  setLabelToggle($('#all-labels-open'),expanded,'labels.a4_generate','labels.a4_hide');
}
async function toggleLabelGallery() {
  const gallery=$('#label-gallery');
  const expanded=gallery.hidden!==false;
  gallery.hidden=!expanded;
  setLabelToggle($('#label-gallery-open'),expanded,'labels.gallery_generate','labels.gallery_hide');
  if(expanded) {
    const spools=inventoryState.spools;
    if(!galleryLabels.size || spools.length!==galleryLabels.size || spools.some(spool=>galleryLabels.get(spool.id)?.spool!==spool))await showLabelGallery();
  }
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
  $('#label-gallery-open').onclick=toggleLabelGallery;
  $('#label-gallery').oninput=editGalleryLabel;
  $('#label-gallery').onchange=editGalleryLabel;
  $('#label-gallery').onclick=useGalleryLabel;
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
  $('#all-labels-open').onclick = toggleAllLabels;
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
