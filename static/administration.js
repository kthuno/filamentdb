import { t, th, getLocale } from './i18n.js';
import { $, esc, request } from './core.js';

let materialTypeRecords=[];
let materialTypeEditing=null;
let materialTypeVersion=0;
let materialsChanged=async()=>{};
function resetMaterialTypeForm() {
  materialTypeEditing=null;
  $('#material-type-name').value='';
  $('#material-type-save').textContent=t('admin.material_create');
  $('#material-type-cancel').hidden=true;
}
async function loadMaterialTypeAdmin() {
  const version=++materialTypeVersion;
  const records=await request('/api/material-types?details=1');
  if(version!==materialTypeVersion)return;
  materialTypeRecords=records;
  $('#material-type-list').innerHTML=records.map((item,index)=>`<article class="admin-material-row"><div><strong>${esc(item.name)}</strong><p>${th('admin.material_usage',{spools:item.spool_count,projects:item.project_count})}</p></div><div class="admin-material-actions"><button type="button" data-material-edit="${index}" ${item.in_use ? `disabled title="${th('admin.material_in_use')}"` : ''}>${th('ui.omdoeb_f917d1')}</button><button type="button" class="danger" data-material-delete="${index}" ${item.in_use ? `disabled title="${th('admin.material_in_use')}"` : ''}>${th('ui.slet_b9f4c0')}</button></div></article>`).join('') || `<p>${th('admin.material_empty')}</p>`;
}
let databaseBackend=null;
async function loadVersionInfo() {
  try {
    const data=await request('/api/version');
    databaseBackend=data.database;
    const database={sqlite:'SQLite',mysql:'MySQL'}[data.database] || t('ui.database_fa7fe6');
    $('#app-version').textContent=t('ui.filament_db_v_9d6f6e',{p0:data.version});
    $('#admin-app-version').textContent=data.version;
    $('#admin-database').textContent=database;
    $('#admin-info-error').textContent='';
  } catch {
    $('#app-version').textContent=t('ui.version_utilgaengelig_38bcad');
    $('#admin-app-version').textContent=t('ui.version_utilgaengelig_38bcad');
    $('#admin-database').textContent=t('ui.database_utilgaengelig_12cf8e');
    $('#admin-info-error').textContent=t('admin.info_error');
  }
}
let databaseStatusRequest=null;
async function loadDatabaseStatus() {
  if(databaseStatusRequest)return databaseStatusRequest;
  const state=$('#admin-db-state');
  state.setAttribute?.('data-state','checking');
  $('#admin-db-state-text').textContent=t('admin.db_checking');
  $('#admin-db-latency').textContent='—';
  databaseStatusRequest=(async()=>{
    try {
      const data=await request('/api/system-status');
      if(data.database_online!==true || !Number.isFinite(data.response_ms) || data.response_ms<0)throw new Error('Invalid database status');
      databaseBackend=data.database || databaseBackend;
      state.setAttribute?.('data-state','online');
      $('#admin-db-state-text').textContent=t(databaseBackend==='sqlite' ? 'admin.db_sqlite_readable' : 'admin.db_online');
      $('#admin-db-latency').textContent=t('admin.db_latency',{ms:new Intl.NumberFormat(getLocale(),{maximumFractionDigits:2}).format(data.response_ms)});
    } catch {
      state.setAttribute?.('data-state','offline');
      $('#admin-db-state-text').textContent=t(databaseBackend==='sqlite' ? 'admin.db_sqlite_unreadable' : 'admin.db_offline');
    } finally {
      const time=new Intl.DateTimeFormat(getLocale(),{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());
      $('#admin-db-checked').textContent=t('admin.db_checked',{time});
    }
  })();
  try { await databaseStatusRequest; } finally { databaseStatusRequest=null; }
}
async function loadApplicationInfo() {
  const button=$('#admin-info-refresh');
  button.disabled=true;
  try { await Promise.all([loadVersionInfo(),loadDatabaseStatus()]); }
  finally { button.disabled=false; }
}
function initAdministration({onMaterialsChanged}) {
  materialsChanged=onMaterialsChanged;
  $('#admin-info-refresh').onclick=loadApplicationInfo;
  $('#material-type-cancel').onclick=resetMaterialTypeForm;
  $('#material-type-form').onsubmit=async event=>{
    event.preventDefault();
    const button=$('#material-type-save');
    if(button.disabled)return;
    button.disabled=true;$('#material-type-error').textContent='';
    const name=$('#material-type-name').value;
    try {
      await request('/api/material-types',{method:materialTypeEditing===null?'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(materialTypeEditing===null?{name}:{name:materialTypeEditing,new_name:name})});
      resetMaterialTypeForm();
      await loadMaterialTypeAdmin();
      await materialsChanged();
    } catch(error) { $('#material-type-error').textContent=error.message; }
    finally { button.disabled=false; }
  };
  $('#material-type-list').onclick=async event=>{
    const edit=event.target.closest('[data-material-edit]');
    const remove=event.target.closest('[data-material-delete]');
    const button=edit || remove;
    if(!button || button.disabled)return;
    const item=materialTypeRecords[Number(edit ? edit.dataset.materialEdit : remove.dataset.materialDelete)];
    if(!item || item.in_use)return;
    if(edit) {
      materialTypeEditing=item.name;
      $('#material-type-name').value=item.name;
      $('#material-type-save').textContent=t('ui.gem_navn_897c73');
      $('#material-type-cancel').hidden=false;
      $('#material-type-name').focus();
      return;
    }
    if(!confirm(t('admin.material_delete_confirm',{name:item.name})))return;
    button.disabled=true;$('#material-type-error').textContent='';
    try {
      await request('/api/material-types',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:item.name})});
      if(materialTypeEditing===item.name)resetMaterialTypeForm();
      await loadMaterialTypeAdmin();
      await materialsChanged();
    } catch(error) { $('#material-type-error').textContent=error.message;button.disabled=false; }
  };
}
export { initAdministration, loadMaterialTypeAdmin, loadApplicationInfo, loadVersionInfo, loadDatabaseStatus, openAdministrationSection };

function openAdministrationSection(hash) {
  const targets={language:'admin-language',printer:'m220-panel','build-plates':'build-plates-view',materials:'admin-materials',categories:'admin-categories',info:'admin-info'};
  const key=hash.replace(/^#admin\//,'');
  if(!Object.hasOwn(targets,key))return;
  const target=targets[key];
  const panel=$('#'+target);
  panel.scrollIntoView?.({block:'start'});
}
