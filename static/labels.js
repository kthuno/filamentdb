import { t, th } from './i18n.js';
import { $, compareLocations, esc, number, productLink, request } from './core.js';
import { inventoryState } from './inventory-data.js';
import qrcodegen from './vendor/qrcodegen.js';
import { LABEL_SIZES, thermalLabel, labelPng } from './thermal-labels.js';
import { openNativeLabelPrinter } from './label-print-dialog.js';
import { initLabelTemplateSettings, refreshLabelTemplateSpools } from './label-template-settings.js';
import { filterLabelSpools, labelListPage } from './label-list-model.js';
import { isBambuBrand } from './label-style.js';
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

function profileRange(values,unit) { return `${values[0]}${values[0]===values[1]?'':`–${values[1]}`}${unit}`; }
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
let galleryVersion=0,nativeListVersion=0,nativeOpenVersion=0;
let galleryLabels=new Map();
let galleryPage=0,nativePage=0;
const labelProfileCache=new Map();
let labelProfileActive=0;
const labelProfileWaiters=[];
function labelFilters() {
  return {search:$('#label-search').value,material:$('#label-material-filter').value,manufacturer:$('#label-manufacturer-filter').value};
}
function filteredLabelEntries() {
  return filterLabelSpools([...galleryLabels.values()].map(entry=>entry.spool),labelFilters()).map(spool=>galleryLabels.get(spool.id));
}
function updateLabelFilterOptions() {
  for(const [id,field,key] of [['label-material-filter','material','ui.alle_materialer_4b987d'],['label-manufacturer-filter','manufacturer','labels.all_manufacturers']]) {
    const select=$('#'+id),current=select.value;
    const values=[...new Set([...galleryLabels.values()].map(entry=>entry.spool[field]).filter(Boolean))].sort();
    select.innerHTML=`<option value="">${th(key)}</option>`+values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
    select.value=values.includes(current)?current:'';
  }
}
function syncLabelEntries() {
  const spools=[...inventoryState.spools].sort(compareLocations);
  if(spools.length===galleryLabels.size && spools.every(spool=>galleryLabels.get(spool.id)?.spool===spool))return false;
  const previous=galleryLabels;
  galleryLabels=new Map(spools.map(spool=>{
    const old=previous.get(spool.id);
    if(old?.spool===spool)return [spool.id,old];
    const options=galleryDefaults(spool,null),dirty=new Set(old?.dirty||[]);
    if(old)for(const key of Object.keys(options))if(dirty.has(key) || ['layout','size','format'].includes(key))options[key]=old.options[key];
    return [spool.id,{spool,options,dirty,label:null,profile:null,profileState:'loading',profilePromise:null,plate:0,dryingMethod:0}];
  }));
  ++galleryVersion;++nativeListVersion;updateLabelFilterOptions();return true;
}
async function fetchLabelProfile(spool) {
  if(!isBambuBrand(spool.manufacturer))return null;
  const params=new URLSearchParams({manufacturer:spool.manufacturer,material:spool.material}),key=params.toString();
  if(!labelProfileCache.has(key))labelProfileCache.set(key,(async()=>{
    if(labelProfileActive>=4)await new Promise(resolve=>labelProfileWaiters.push(resolve));else labelProfileActive++;
    try {return await request('/api/material-profiles?'+params);}
    catch(error){labelProfileCache.delete(key);throw error;}
    finally {const next=labelProfileWaiters.shift();if(next)next();else labelProfileActive--;}
  })());
  return labelProfileCache.get(key);
}
function ensureLabelProfile(entry) {
  if(entry.profilePromise)return entry.profilePromise;
  entry.profilePromise=(async()=>{
    try {
      entry.profile=await fetchLabelProfile(entry.spool);entry.profileState=entry.profile?'found':'missing';
      const defaults=galleryDefaults(entry.spool,entry.profile);
      for(const field of ['nozzle','bed','flow','drying'])if(!entry.dirty.has(field))entry.options[field]=defaults[field];
      if(entry.profile)entry.plate=Math.max(0,entry.profile.bed_temperatures.findIndex(plate=>plate.plate==='Textured PEI Plate'));
    } catch {entry.profileState='failed';}
  })();
  return entry.profilePromise;
}
function labelProfileStatus(entry) {
  return entry.profileState==='failed'?t('labels.profile_error'):entry.profileState==='found'?t('labels.profile_found',{material:entry.profile.material}):entry.profileState==='missing'?t('labels.no_profile'):t('labels.loading_profile');
}
function galleryGuideControls(entry) {
  const profile=entry.profile;if(!profile)return '';
  const select=(field,key,items,current)=>`<label>${th(key)}<select data-gallery-field="${field}">${items.map(([value,label])=>`<option value="${value}"${Number(current)===value?' selected':''}>${esc(label)}</option>`).join('')}</select></label>`;
  const plate=select('plate','labels.guide_plate',profile.bed_temperatures.map((plate,index)=>[index,plate.plate+' · '+profileRange(plate.temperature_c,'°C')]),entry.plate);
  const drying=select('dryingMethod','labels.guide_drying',profile.drying_conditions.map((condition,index)=>[index,t(condition.method==='blast_oven'?'labels.drying_method_blast_oven':'labels.drying_method_printer_heatbed')]),entry.dryingMethod);
  const condition=profile.drying_conditions[entry.dryingMethod],notes=[];
  if(profile.flow_ratio==null)notes.push(t('labels.flow_not_in_guide'));
  if(condition?.method==='printer_heatbed')notes.push(t('labels.heatbed_drying_note'));
  if(['PPS-CF','PPA-CF'].includes(profile.material) && condition?.method==='blast_oven')notes.push(t('labels.high_temp_drying_note'));
  if(profile.material==='PPS-CF' && condition?.method==='printer_heatbed')notes.push(t('labels.less_effective_drying_note'));
  return `<div class="thermal-controls">${plate}${drying}</div><p>${notes.map(esc).join(' ')}</p><div class="thermal-guide-actions"><button type="button" data-gallery-action="guide">${th('labels.use_guide')}</button><a href="${esc(productLink(profile.source_url))}" target="_blank" rel="noopener noreferrer">${th('labels.guide_source')}</a></div>`;
}
function galleryCard(entry) {
  const {spool,options}=entry;
  const fieldKeys={nozzle:'labels.nozzle',bed:'labels.bed',flow:'labels.flow',drying:'labels.drying'};
  const input=field=>`<label>${th(fieldKeys[field])}<input data-gallery-field="${field}" maxlength="80" value="${esc(options[field])}"></label>`;
  const select=(field,key,items)=>`<label>${th(key)}<select data-gallery-field="${field}">${items.map(([value,text])=>`<option value="${value}"${options[field]===value?' selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
  return `<article class="label-gallery-card" data-gallery-id="${spool.id}">
    <h3>${esc(spool.material)} · ${esc(spool.color || spool.name)}</h3>
    <p>${esc(spool.name)} · ${esc(spool.manufacturer)}</p><p>${th('ui.spole_c5f792',{p4:spool.id,p5:esc(spool.location || t('ui.ingen_placering_96a4dd'))})}${spool.archived?' · '+th('labels.archived'):''}</p>
    <div class="gallery-preview"></div><p class="gallery-status" role="status">${esc(labelProfileStatus(entry))}</p>
    <div class="gallery-guide">${galleryGuideControls(entry)}</div><div class="thermal-controls">
      ${select('layout','labels.layout',[['extended',t('labels.extended')],['compact',t('labels.compact')]])}
      ${select('size','labels.size',Object.keys(LABEL_SIZES).map(size=>[size,size.replace('x',' × ')+' mm']))}
      ${['nozzle','bed','flow','drying'].map(input).join('')}
      ${select('format','labels.filetype',[['png',t('labels.png')],['svg',t('labels.svg')]])}
    </div><p class="gallery-error" role="alert"></p>
    <div class="modal-actions"><button type="button" data-gallery-action="download">${th('labels.download')}</button>
    <button type="button" class="primary" data-gallery-action="print">${th('ui.print_label_a1aa7b')}</button></div>
  </article>`;
}
function refreshGalleryCard(card,entry) {
  if(!card)return;
  const error=card.querySelector('.gallery-error');error.textContent='';entry.label=null;
  try {entry.label=thermalLabel(entry.spool,spoolLink(entry.spool),entry.options);card.querySelector('.gallery-preview').innerHTML=entry.label.svg;}
  catch(problem){card.querySelector('.gallery-preview').innerHTML='';error.textContent=problem.message;}
  for(const button of card.querySelectorAll('[data-gallery-action]'))if(button.dataset?.galleryAction!=='guide')button.disabled=!entry.label;
}
function labelPagination(prefix,page) {
  $('#'+prefix+'-count').textContent=t('labels.page_summary',{count:page.total,total:galleryLabels.size,page:page.index+1,pages:page.pages});
  $('#'+prefix+'-previous').disabled=page.index===0;
  $('#'+prefix+'-next').disabled=page.index+1>=page.pages;
}
async function renderLabelGallery() {
  const version=++galleryVersion,gallery=$('#label-gallery'),page=labelListPage(filteredLabelEntries(),galleryPage);galleryPage=page.index;
  labelPagination('label-gallery',page);
  gallery.innerHTML=page.records.length?page.records.map(galleryCard).join(''):`<p>${th('labels.no_matches')}</p>`;
  await Promise.all(page.records.map(async entry=>{
    const card=gallery.querySelector(`[data-gallery-id="${entry.spool.id}"]`);refreshGalleryCard(card,entry);
    await ensureLabelProfile(entry);
    if(version!==galleryVersion || gallery.hidden)return;
    for(const field of ['nozzle','bed','flow','drying'])card.querySelector(`[data-gallery-field="${field}"]`).value=entry.options[field];
    card.querySelector('.gallery-status').textContent=labelProfileStatus(entry);
    card.querySelector('.gallery-guide').innerHTML=galleryGuideControls(entry);refreshGalleryCard(card,entry);
  }));
}
async function showLabelGallery() {syncLabelEntries();return renderLabelGallery();}
function updateGalleryGuide(entry) {
  const plate=entry.profile?.bed_temperatures[entry.plate],drying=entry.profile?.drying_conditions[entry.dryingMethod];
  if(plate){entry.options.bed=profileRange(plate.temperature_c,'°C');entry.dirty.add('bed');}
  if(drying){entry.options.drying=profileRange(drying.temperature_c,'°C')+'/'+profileRange(drying.hours,'h');entry.dirty.add('drying');}
}
function editGalleryLabel(event) {
  const field=event.target.dataset.galleryField,card=event.target.closest('[data-gallery-id]'),entry=card && galleryLabels.get(Number(card.dataset.galleryId));
  if(!entry)return;
  if(['plate','dryingMethod'].includes(field)) {
    entry[field]=Number(event.target.value);updateGalleryGuide(entry);
    for(const key of ['bed','drying'])card.querySelector(`[data-gallery-field="${key}"]`).value=entry.options[key];
    card.querySelector('.gallery-guide').innerHTML=galleryGuideControls(entry);
  } else {
    if(!Object.hasOwn(entry.options,field))return;
    entry.options[field]=event.target.value;entry.dirty.add(field);
  }
  refreshGalleryCard(card,entry);
}
function clearSingleLabelPrint() {
  $('#single-label-print').dataset.printActive='false';$('#single-label-print').innerHTML='';$('#label-print-page-style').textContent='';
}
async function useGalleryLabel(event) {
  const button=event.target.closest('[data-gallery-action]'),card=button?.closest('[data-gallery-id]'),entry=card && galleryLabels.get(Number(card.dataset.galleryId));
  if(!entry || button.disabled)return;
  if(button.dataset.galleryAction==='guide') {
    const defaults=galleryDefaults(entry.spool,entry.profile);
    for(const field of ['nozzle','bed','flow','drying']){entry.options[field]=defaults[field];entry.dirty.add(field);}
    updateGalleryGuide(entry);
    for(const field of ['nozzle','bed','flow','drying'])card.querySelector(`[data-gallery-field="${field}"]`).value=entry.options[field];
    refreshGalleryCard(card,entry);return;
  }
  if(!entry.label)return;
  if(button.dataset.galleryAction==='print') {
    $('#selected-labels-pages').dataset.printActive='false';
    $('#single-label-print').innerHTML=entry.label.svg;$('#single-label-print').dataset.printActive='true';
    $('#label-print-page-style').textContent=`@media print { @page thermal-label { size: ${entry.label.mmWidth}mm ${entry.label.mmHeight}mm; margin: 0; } }`;
    try {window.print();}catch {clearSingleLabelPrint();card.querySelector('.gallery-error').textContent=t('labels.print_error');}
  } else {
    button.disabled=true;card.querySelector('.gallery-error').textContent='';
    try {await saveLabelImage(entry.spool,entry.label,entry.options,entry.options.format);}
    catch {card.querySelector('.gallery-error').textContent=t('labels.download_error');}
    finally {button.disabled=!entry.label;}
  }
}
function nativeSpoolCard(entry) {
  const spool=entry.spool;
  const color=/^#[0-9a-f]{6}$/i.test(spool.color_hex)?spool.color_hex:'#bd93f9';
  const weight=Math.max(0,Number(spool.weight)||0),remaining=Math.max(0,Math.min(weight,Number(spool.remaining)||0));
  const percent=weight?Math.round(remaining/weight*100):0;
  const location=spool.active_slot || spool.location || t('ui.ingen_placering_96a4dd');
  const printIcon='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6zM17 12h1"/></svg>';
  return `<article class="native-spool-card" data-native-spool="${spool.id}" style="--spool:${color};--spool-glow:${color}24">
    <div class="native-spool-art"><div class="native-spool-labels"><span class="native-spool-type">${esc(spool.material)}</span><span class="native-spool-id">#${esc(spool.id)}</span></div>
      <div class="native-spool-illustration" aria-hidden="true"><div class="spool${spool.transparency==='transparent'?' transparent-spool':''}"></div></div></div>
    <div class="manufacturer">${esc(spool.manufacturer)}</div><h3>${esc(spool.name)}</h3>
    <div class="native-spool-color"><span class="swatch" style="background:${color}" aria-hidden="true"></span><span>${esc(spool.color || (spool.transparency==='transparent'?t('ui.klar_79aac7'):t('ui.ingen_farve_angivet_930385')))}</span>${spool.transparency==='transparent'?`<span class="native-spool-transparent">${th('ui.transparent_c8a1fe')}</span>`:''}</div>
    ${spool.product_id?`<p class="native-spool-product">${th('ui.produkt_id_ed128a',{p0:esc(spool.product_id)})}</p>`:''}
    <div class="native-spool-location" title="${esc(location)}"><span aria-hidden="true">⌖</span><span>${esc(location)}</span></div>
    ${spool.archived?`<span class="native-spool-archived">${th('labels.archived')}</span>`:''}
    <div class="native-spool-footer"><div class="native-spool-weight"><span><b>${number(remaining)} g</b><small>${th('ui.g_1b1ff7',{p17:number(weight)})}</small></span><span>${th('ui.tilbage_312c7e',{p19:percent})}</span></div>
    <div class="bar" aria-hidden="true"><span style="width:${percent}%;${percent<20?'background:var(--orange,#ffb86c)':''}"></span></div>
    <p data-native-spool-status role="status"></p><button type="button" class="primary" data-open-native="${spool.id}">${printIcon}<span>${th('labels.native_edit_print')}</span></button></div></article>`;
}
function renderNativeLabelList() {
  ++nativeListVersion;const page=labelListPage(filteredLabelEntries(),nativePage);nativePage=page.index;
  labelPagination('native-labels',page);
  $('#native-label-list').innerHTML=page.records.length?page.records.map(nativeSpoolCard).join(''):`<p>${th('labels.no_matches')}</p>`;
}
async function openNativeSpool(event) {
  const button=event.target.closest('[data-open-native]');if(!button || button.disabled)return;
  const entry=galleryLabels.get(Number(button.dataset.openNative));if(!entry)return;
  const version=nativeListVersion,attempt=++nativeOpenVersion,status=button.closest('[data-native-spool]').querySelector('[data-native-spool-status]');
  button.disabled=true;status.textContent=t('labels.loading_profile');
  try {
    await ensureLabelProfile(entry);
    if(attempt!==nativeOpenVersion || version!==nativeListVersion || $('#native-labels-panel').hidden || $('#qr-labels-view').hidden)return;
    status.textContent=labelProfileStatus(entry);
    const {nozzle,bed,flow,drying}=entry.options;
    return await openNativeLabelPrinter(entry.spool,spoolLink(entry.spool),{nozzle,bed,flow,drying});
  } finally {button.disabled=false;status.textContent=labelProfileStatus(entry);}
}
function updateLabelMatchCount() {$('#label-filter-summary').textContent=t('labels.filter_summary',{count:filteredLabelEntries().length,total:galleryLabels.size});}
async function refreshLabels() {
  if($('#qr-labels-view').hidden!==false)return;
  const changed=syncLabelEntries();updateLabelMatchCount();
  await refreshLabelTemplateSpools();
  if(!changed)return;
  const pending=[];
  if($('#label-gallery').hidden===false)pending.push(renderLabelGallery());
  if($('#native-labels-panel').hidden===false)renderNativeLabelList();
  if($('#all-labels-panel').hidden===false) {
    const selected=new Set(selectedLabelIds);labelRecords=[...galleryLabels.values()].map(entry=>entry.spool);
    selectedLabelIds=new Set(labelRecords.filter(spool=>selected.has(spool.id)).map(spool=>spool.id));renderLabelChoices();
  }
  await Promise.all(pending);
}
async function applyLabelFilters() {
  syncLabelEntries();galleryPage=0;nativePage=0;updateLabelMatchCount();
  if($('#native-labels-panel').hidden===false)renderNativeLabelList();
  if($('#label-gallery').hidden===false)await renderLabelGallery();
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
  const gallery=$('#label-gallery'),expanded=gallery.hidden!==false;
  gallery.hidden=!expanded;$('#label-gallery-pagination').hidden=!expanded;
  setLabelToggle($('#label-gallery-open'),expanded,'labels.gallery_generate','labels.gallery_hide');
  if(expanded){syncLabelEntries();updateLabelMatchCount();await renderLabelGallery();}else ++galleryVersion;
}
function toggleNativeLabels() {
  const panel=$('#native-labels-panel'),expanded=panel.hidden!==false;panel.hidden=!expanded;
  setLabelToggle($('#native-labels-open'),expanded,'labels.native_show','labels.native_hide');
  if(expanded){syncLabelEntries();updateLabelMatchCount();renderNativeLabelList();}else ++nativeListVersion;
}
function prepareLabelPrinting() {
  $('#selected-labels-pages').dataset.printActive=String(!$('#qr-labels-view').hidden && !$('#all-labels-panel').hidden && $('#single-label-print').dataset.printActive!=='true' && !$('#native-label-dialog').open);
}
function initLabels() {
  initLabelTemplateSettings({getProfileForSpool:async spool=>{
    syncLabelEntries();const entry=galleryLabels.get(spool.id);await ensureLabelProfile(entry);
    const {nozzle,bed,flow,drying}=entry.options;return {nozzle,bed,flow,drying};
  }});
  $('#label-gallery-open').onclick=toggleLabelGallery;
  $('#label-gallery').oninput=editGalleryLabel;$('#label-gallery').onchange=editGalleryLabel;$('#label-gallery').onclick=useGalleryLabel;
  $('#native-labels-open').onclick=toggleNativeLabels;$('#native-label-list').onclick=openNativeSpool;
  for(const id of ['label-search','label-material-filter','label-manufacturer-filter'])$('#'+id).oninput=applyLabelFilters;
  $('#label-filters-reset').onclick=()=>{
    for(const id of ['label-search','label-material-filter','label-manufacturer-filter'])$('#'+id).value='';
    return applyLabelFilters();
  };
  $('#label-gallery-previous').onclick=()=>{galleryPage--;return renderLabelGallery();};
  $('#label-gallery-next').onclick=()=>{galleryPage++;return renderLabelGallery();};
  $('#native-labels-previous').onclick=()=>{nativePage--;renderNativeLabelList();};
  $('#native-labels-next').onclick=()=>{nativePage++;renderNativeLabelList();};
  $('#all-labels-pages').onchange=event=>{
    const checkbox=event.target.closest('[data-label-spool]');if(!checkbox)return;
    const id=Number(checkbox.dataset.labelSpool);if(!labelRecords.some(spool=>spool.id===id))return;
    if(checkbox.checked)selectedLabelIds.add(id);else selectedLabelIds.delete(id);updateLabelSelection();
  };
  $('#all-labels-select-all').onclick=()=>{selectedLabelIds=new Set(labelRecords.map(spool=>spool.id));renderLabelChoices();};
  $('#all-labels-deselect-all').onclick=()=>{selectedLabelIds.clear();renderLabelChoices();};
  $('#all-labels-open').onclick=toggleAllLabels;
  window.addEventListener('beforeprint',prepareLabelPrinting);
  window.addEventListener('afterprint',()=>{$('#selected-labels-pages').dataset.printActive='false';clearSingleLabelPrint();});
  $('#all-labels-print').onclick=()=>{if($('#all-labels-print').disabled)return;clearSingleLabelPrint();prepareLabelPrinting();window.print();};
}
export { initLabels, refreshLabels };
