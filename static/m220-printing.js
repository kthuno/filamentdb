import { t } from './i18n.js';
import { M220Printer, m220SupportReason } from './m220-bluetooth.js';

// Optional UI adapter. Remove this module's registration in labels.js to detach it.
function initM220Printing({getDialogLabel,getGalleryLabel}) {
  const panel=document.querySelector('#m220-panel');
  if(!panel)return;
  const find=selector=>document.querySelector(selector);
  const all=selector=>Array.from(document.querySelectorAll?.(selector) || []);
  const enabledInput=find('#m220-enabled');
  let enabled=false,activeStatus=null,statusKey='m220.disabled';
  const errors={
    secure_required:'m220.secure_required',unsupported:'m220.unsupported',wrong_device:'m220.wrong_device',
    incompatible:'m220.incompatible',cancelled:'m220.cancelled',permission_denied:'m220.permission_denied',
    connection_failed:'m220.connection_failed',disconnected:'m220.disconnected',busy:'m220.busy',
    invalid_image:'m220.invalid_image',invalid_settings:'m220.invalid_settings',timeout:'m220.send_failed',send_failed:'m220.send_failed',
  };
  function status(key,params={}) {
    statusKey=key;
    for(const node of [find('#m220-status'),find('#m220-dialog-status'),activeStatus])if(node) {
      node.textContent=t(key,params);
      node.hidden=!enabled;
    }
  }
  const printer=new M220Printer({onState:state=>{
    if(!state.connected && !state.busy && ['m220.connected','m220.sent'].includes(statusKey))status('m220.disconnected');
    render();
  }});
  function render() {
    const {connected,busy}=printer.state();
    const reason=m220SupportReason();
    find('#m220-connect').disabled=!enabled || busy || connected || Boolean(reason);
    find('#m220-disconnect').disabled=!enabled || (!connected && !busy);
    for(const input of all('[data-m220-setting]'))input.disabled=!enabled || busy;
    for(const button of all('[data-m220-print]')) {
      button.hidden=!enabled;
      button.disabled=!enabled || !connected || busy;
    }
    if(!enabled)for(const node of all('[data-m220-status]'))node.hidden=true;
  }
  function failure(error,printing=false) {
    status(printing && !['invalid_image','invalid_settings','busy'].includes(error.code)
      ? 'm220.send_failed' : errors[error.code] || 'm220.connection_failed');
  }
  function changeEnabled() {
    enabled=enabledInput.checked;
    try { globalThis.localStorage?.setItem('filamentdb.m220.enabled',String(enabled)); } catch {}
    const availability=find('#m220-availability');
    const availabilityKey=enabled ? 'm220.available' : 'm220.unavailable';
    availability.textContent=t(availabilityKey);
    availability.setAttribute?.('data-available',String(enabled));
    availability.setAttribute?.('data-i18n-text','0:'+availabilityKey);
    if(!enabled)printer.disconnect();
    status(!enabled ? 'm220.disabled' : m220SupportReason() ? errors[m220SupportReason()] : 'm220.ready');
    // Keep the explanation visible when disabled as well.
    find('#m220-status').hidden=false;
    render();
  }
  enabledInput.onchange=changeEnabled;
  const settings={density:find('#m220-density'),feed:find('#m220-feed'),chunk:find('#m220-chunk')};
  const validSetting=(key,value)=>Number.isInteger(value) && (key==='density' ? value>=1 && value<=8 : key==='feed' ? value>=0 && value<=255 : [20,128].includes(value));
  try {
    const saved=JSON.parse(globalThis.localStorage?.getItem('filamentdb.m220.settings') || '{}');
    for(const [key,input] of Object.entries(settings))if(validSetting(key,saved?.[key]))input.value=String(saved[key]);
  } catch {}
  for(const input of Object.values(settings))input.onchange=()=>{
    const values=Object.fromEntries(Object.entries(settings).map(([key,input])=>[key,Number(input.value)]));
    if(Object.entries(values).every(([key,value])=>validSetting(key,value))) {
      try { globalThis.localStorage?.setItem('filamentdb.m220.settings',JSON.stringify(values)); } catch {}
    }
  };
  find('#m220-connect').onclick=async()=>{
    if(!enabled || printer.busy)return;
    status('m220.connecting');
    try { await printer.connect();if(enabled)status('m220.connected',{name:printer.state().name}); }
    catch(error) { if(enabled)failure(error); }
    finally { render(); }
  };
  find('#m220-disconnect').onclick=()=>{printer.disconnect();status('m220.disconnected');render();};
  async function printClick(event) {
    const button=event.target.closest('[data-m220-print]');
    if(!button || button.disabled || !enabled)return;
    const label=button.dataset.m220Print==='dialog' ? getDialogLabel() : getGalleryLabel(Number(button.dataset.m220Print));
    activeStatus=button.closest('[data-gallery-id]')?.querySelector('[data-m220-status]') || null;
    if(!label) { status('m220.invalid_image');return; }
    const options={density:Number(find('#m220-density').value),feed:Number(find('#m220-feed').value),chunkSize:Number(find('#m220-chunk').value)};
    status('m220.sending',{percent:0});
    try {
      await printer.print(label,{...options,onProgress:percent=>{if(enabled)status('m220.sending',{percent});}});
      if(enabled)status('m220.sent');
    } catch(error) { if(enabled)failure(error,true); }
    finally { render(); }
  }
  document.addEventListener?.('click',printClick);
  // New gallery cards get the current connection state without modifying its lifecycle.
  if(typeof MutationObserver!=='undefined')new MutationObserver(render).observe(find('#label-gallery'),{childList:true});
  globalThis.window?.addEventListener('pagehide',()=>printer.disconnect());
  try { enabledInput.checked=globalThis.localStorage?.getItem('filamentdb.m220.enabled')==='true'; } catch { enabledInput.checked=false; }
  changeEnabled();
}
export { initM220Printing };
