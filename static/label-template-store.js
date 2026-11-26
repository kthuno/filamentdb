import { getLanguage } from './i18n.js';
import { PrinterError } from './printer-transport.js';
import { importLabelTemplate, readLabelTemplate, setSharedLabelTemplates } from './label-templates.js';

let templateRequestId=0,templateAppliedId=0;
async function templateRequest(path,options={}) {
  try {
    const response=await fetch('/api/label-templates'+path,{...options,headers:{'Content-Type':'application/json','Accept-Language':getLanguage()}});
    if(!response.ok)throw new PrinterError(response.status===409?'template_conflict':'template_database_failed');
    return await response.json();
  }catch(error){throw error instanceof PrinterError?error:new PrinterError('template_database_failed');}
}
export async function loadSharedLabelTemplates() {
  const request=++templateRequestId,data=await templateRequest('');
  if(request>templateAppliedId){setSharedLabelTemplates(data.templates,data.app_version);templateAppliedId=request;}
}
export async function saveSharedLabelTemplate(size,json,{onlyIfEmpty=false,expectedRevision}={}) {
  const design=importLabelTemplate(json,size),existing=readLabelTemplate(size);
  if(onlyIfEmpty && existing)throw new PrinterError('template_conflict');
  await templateRequest('/'+size,{method:'PUT',body:JSON.stringify({design,expected_revision:expectedRevision===undefined?(existing?.revision||null):expectedRevision})});
  await loadSharedLabelTemplates();return readLabelTemplate(size);
}
export async function removeSharedLabelTemplate(size) {
  const existing=readLabelTemplate(size);
  await templateRequest('/'+size,{method:'DELETE',body:JSON.stringify({expected_revision:existing?.revision||null})});
  await loadSharedLabelTemplates();
}
