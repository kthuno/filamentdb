import { esc } from './core.js';
import { t, th } from './i18n.js';
import { PhomymoDesigner, designerFrameHTML } from './phomymo-designer.js';
import { readLabelTemplate, exampleLabelTemplate, importLabelTemplate, TEMPLATE_VARIABLES } from './label-templates.js';
import { saveSharedLabelTemplate } from './label-template-store.js';
import { printErrorCode } from './printer-transport.js';

export function openTemplateDesigner(size,{onSaved=()=>{}}={}) {
  const record=readLabelTemplate(size),design=record?.design||exampleLabelTemplate(size),revision=record?.revision||null;
  const dialog=document.createElement('dialog');dialog.className='template-designer-dialog';
  dialog.innerHTML=`<div class="modal-heading"><h2>${th('designer.template_title',{size:esc(size.replace('x',' × '))})}</h2><button type="button" data-designer-close>${th('native.close')}</button></div>
    <p>${th('designer.template_help')}</p><div class="designer-toolbar"><label>${th('native.name')}<input data-designer-name maxlength="200"></label><label>${th('designer.variable')}<select data-designer-variable>${TEMPLATE_VARIABLES.map(name=>`<option value="${name}">$${name}$</option>`).join('')}</select></label><button type="button" data-designer-insert>${th('designer.insert_variable')}</button></div>
    <p data-designer-error role="alert"></p>${designerFrameHTML()}<div class="modal-actions"><button type="button" data-designer-save disabled>${th('designer.save_template')}</button></div>`;
  document.body.append(dialog);dialog.querySelector('[data-designer-name]').value=design.name;
  const error=problem=>{dialog.querySelector('[data-designer-error]').textContent=t(`native.error_${problem.code||printErrorCode(problem)}`);};
  const button=dialog.querySelector('[data-designer-save]');
  const editor=new PhomymoDesigner(dialog.querySelector('iframe'),{design,validate:json=>importLabelTemplate(json,size),onError:error,onReady:()=>{button.disabled=false;}});
  let saving=false;
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  dialog.addEventListener('close',()=>{editor.dispose();dialog.remove();},{once:true});
  dialog.querySelector('[data-designer-close]').onclick=()=>{if(!saving)dialog.close();};
  dialog.querySelector('[data-designer-insert]').onclick=()=>editor.insert('$'+dialog.querySelector('[data-designer-variable]').value+'$');
  button.onclick=async()=>{
    if(saving)return;saving=true;button.disabled=true;dialog.querySelector('[data-designer-error]').textContent='';
    try {
      const current=await editor.snapshot();current.name=dialog.querySelector('[data-designer-name]').value;
      await saveSharedLabelTemplate(size,JSON.stringify(current),{expectedRevision:revision});
      await onSaved();dialog.close();
    }catch(problem){error(problem);}finally {saving=false;button.disabled=false;}
  };
  dialog.showModal();return dialog;
}
