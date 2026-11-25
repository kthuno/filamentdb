import { $, esc, compareLocations } from './core.js';
import { t, th } from './i18n.js';
import { inventoryState } from './inventory-data.js';
import { filterLabelSpools } from './label-list-model.js';
import { PRINT_PRESETS } from './printer-definitions.js';
import { DESIGN_LIMIT } from './label-design.js';
import { printErrorCode } from './printer-transport.js';
import { readLabelTemplate, TEMPLATE_VARIABLES, createSpoolLabel, exampleLabelTemplate } from './label-templates.js';
import { loadSharedLabelTemplates, saveSharedLabelTemplate, removeSharedLabelTemplate } from './label-template-store.js';
import { renderDesign } from './label-renderer.js';
import { monochromePixels, previewPixels } from './label-raster.js';

const templateImportVersions=new Map();
let templatePreviewVersion=0,templateLoadVersion=0;
let templateProfileForSpool=async()=>({});
function browserTemplate(size) {
  try {if(globalThis.localStorage)return readLabelTemplate(size,globalThis.localStorage);}catch {}
  return null;
}
function templateMessage(error) {return t(`native.error_${error.code||printErrorCode(error)}`,{variable:error.variable||''});}
function templateRow(size) {
  const record=readLabelTemplate(size),legacy=browserTemplate(size),label=size.replace('x',' × ')+' mm';
  return `<article class="label-template-card" data-label-template="${size}"><h3>${esc(label)}</h3>
    <p>${record?th('templates.configured',{name:esc(record.design.name),count:record.design.elements.length}):th('templates.not_configured')}</p>
    <div class="template-preview"><canvas data-template-preview="${size}" hidden></canvas><p data-template-preview-status role="status"></p></div>
    <p data-template-error role="alert"></p>
    <div class="template-card-actions"><label class="native-file-button">${th('templates.import')}<input type="file" accept=".json,application/json" data-template-import="${size}" aria-label="${th('templates.import_size',{size:esc(label)})}"></label>
    <button type="button" data-template-action="example" data-template-size="${size}">${th('templates.example')}</button>
    <button type="button" data-template-action="export" data-template-size="${size}"${record?'':' disabled'}>${th('templates.export')}</button>
    <button type="button" data-template-action="remove" data-template-size="${size}"${record?'':' disabled'}>${th('templates.remove')}</button>
    ${legacy?`<button type="button" data-template-action="migrate" data-template-size="${size}"${record?' disabled':''}>${th('templates.migrate')}</button><button type="button" data-template-action="browser-export" data-template-size="${size}">${th('templates.browser_export')}</button>`:''}</div></article>`;
}
function renderTemplateSettings() {$('#label-template-cards').innerHTML=Object.keys(PRINT_PRESETS).map(templateRow).join('');}
function templateVariableGuide() {
  $('#label-template-variables').innerHTML=`<table><thead><tr><th>${th('templates.variable')}</th><th>${th('templates.meaning')}</th></tr></thead><tbody>${TEMPLATE_VARIABLES.map(name=>`<tr><td><code>$${name}$</code></td><td>${th(`templates.var_${name}`)}</td></tr>`).join('')}</tbody></table>`;
}
function populateTemplatePreviewSpools() {
  const select=$('#label-template-spool'),current=select.value;
  const spools=filterLabelSpools([...inventoryState.spools].sort(compareLocations),{search:$('#label-template-preview-search').value});
  select.innerHTML=spools.map(spool=>`<option value="${spool.id}">#${spool.id} · ${esc(spool.name)} · ${esc(spool.color||spool.material)}</option>`).join('');
  select.value=spools.some(spool=>String(spool.id)===current)?current:spools.length?String(spools[0].id):'';
  select.disabled=!spools.length;
}
async function renderTemplatePreviews() {
  const version=++templatePreviewVersion,spool=inventoryState.spools.find(item=>String(item.id)===$('#label-template-spool').value);
  for(const size of Object.keys(PRINT_PRESETS)) {
    const card=$('#label-template-cards').querySelector(`[data-label-template="${size}"]`);if(!card)continue;
    card.querySelector('[data-template-preview]').hidden=true;
    card.querySelector('[data-template-preview-status]').textContent=t(spool?'templates.preview_loading':'templates.preview_empty');
  }
  if(!spool)return;
  let profile;
  try {profile=await templateProfileForSpool(spool);}catch {profile={};}
  if(version!==templatePreviewVersion)return;
  const link=new URL(window.location.href);link.hash='spool/'+spool.label_token;
  const text={nozzle:t('labels.nozzle'),bed:t('labels.bed'),flow:t('labels.flow'),drying:t('labels.drying')};
  await Promise.all(Object.keys(PRINT_PRESETS).map(async size=>{
    const card=$('#label-template-cards').querySelector(`[data-label-template="${size}"]`);if(!card)return;
    try {
      const {design}=createSpoolLabel(spool,link.href,{...profile,size},text),rendered=await renderDesign(design);
      if(version!==templatePreviewVersion)return;
      const dots=monochromePixels(rendered.pixels,rendered.width,rendered.height,'threshold',rendered.qrRegions),canvas=card.querySelector('[data-template-preview]');
      canvas.width=rendered.width;canvas.height=rendered.height;const ctx=canvas.getContext('2d'),image=ctx.createImageData(rendered.width,rendered.height);image.data.set(previewPixels(dots));ctx.putImageData(image,0,0);canvas.hidden=false;
      card.querySelector('[data-template-preview-status]').textContent=t('templates.preview_spool',{id:spool.id,name:spool.name});
    }catch(error){if(version===templatePreviewVersion)card.querySelector('[data-template-preview-status]').textContent=templateMessage(error);}
  }));
}
export async function refreshLabelTemplateSpools() {
  if($('#label-templates-panel').hidden!==false)return;
  populateTemplatePreviewSpools();await renderTemplatePreviews();
}
async function reloadTemplateSettings() {
  const version=++templateLoadVersion;++templatePreviewVersion;
  $('#label-template-status').textContent=t('templates.loading');
  try {
    await loadSharedLabelTemplates();if(version!==templateLoadVersion)return;
    renderTemplateSettings();populateTemplatePreviewSpools();$('#label-template-status').textContent='';await renderTemplatePreviews();
  }catch(error){if(version===templateLoadVersion)$('#label-template-status').textContent=templateMessage(error);}
}
function downloadLabelTemplate(size,design) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(design,null,2)],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='filament-template-'+size+'.json';
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function templateFailure(size,error) {
  if(error.code==='template_conflict')try {await loadSharedLabelTemplates();renderTemplateSettings();await renderTemplatePreviews();}catch {}
  const card=$('#label-template-cards').querySelector(`[data-label-template="${size}"]`);
  if(card)card.querySelector('[data-template-error]').textContent=templateMessage(error);else $('#label-template-status').textContent=templateMessage(error);
}
async function importTemplateFile(event) {
  const input=event.target,size=input.dataset.templateImport,file=input.files?.[0];if(!file || !Object.hasOwn(PRINT_PRESETS,size))return;
  const version=(templateImportVersions.get(size)||0)+1;templateImportVersions.set(size,version);input.disabled=true;
  const card=input.closest('[data-label-template]');card.querySelector('[data-template-error]').textContent='';$('#label-template-status').textContent='';
  try {
    if(file.size>DESIGN_LIMIT)throw Object.assign(new Error(),{code:'template_invalid'});
    const json=await file.text();if(templateImportVersions.get(size)!==version)return;
    await saveSharedLabelTemplate(size,json);renderTemplateSettings();await renderTemplatePreviews();
    $('#label-template-status').textContent=t('templates.imported',{size:size.replace('x',' × ')});
  }catch(error){if(templateImportVersions.get(size)===version)await templateFailure(size,error);}
  finally {input.disabled=false;input.value='';}
}
async function useTemplateSetting(event) {
  const button=event.target.closest('[data-template-action]');if(!button || button.disabled)return;
  const size=button.dataset.templateSize,action=button.dataset.templateAction;if(!Object.hasOwn(PRINT_PRESETS,size))return;
  button.disabled=true;
  try {
    if(action==='remove' || action==='migrate') {
      templateImportVersions.set(size,(templateImportVersions.get(size)||0)+1);
      if(action==='remove')await removeSharedLabelTemplate(size);
      else await saveSharedLabelTemplate(size,JSON.stringify(browserTemplate(size).design),{onlyIfEmpty:true});
      renderTemplateSettings();await renderTemplatePreviews();$('#label-template-status').textContent=t(action==='remove'?'templates.removed':'templates.migrated',{size:size.replace('x',' × ')});
    }else downloadLabelTemplate(size,action==='example'?exampleLabelTemplate(size):action==='browser-export'?browserTemplate(size).design:readLabelTemplate(size).design);
  }catch(error){await templateFailure(size,error);}finally {button.disabled=false;}
}
export function initLabelTemplateSettings({getProfileForSpool=async()=>({})}={}) {
  templateProfileForSpool=getProfileForSpool;
  $('#label-templates-open').onclick=async()=>{
    const panel=$('#label-templates-panel'),expanded=panel.hidden!==false;panel.hidden=!expanded;
    const key=expanded?'templates.hide':'templates.show';$('#label-templates-open').setAttribute('aria-expanded',String(expanded));$('#label-templates-open').setAttribute('data-i18n-text','0:'+key);$('#label-templates-open').textContent=t(key);
    if(expanded){templateVariableGuide();await reloadTemplateSettings();}else {++templateLoadVersion;++templatePreviewVersion;}
  };
  $('#label-template-reload').onclick=reloadTemplateSettings;
  $('#label-template-spool').onchange=renderTemplatePreviews;
  $('#label-template-preview-search').oninput=()=>{populateTemplatePreviewSpools();return renderTemplatePreviews();};
  $('#label-template-cards').onchange=importTemplateFile;$('#label-template-cards').onclick=useTemplateSetting;
}
