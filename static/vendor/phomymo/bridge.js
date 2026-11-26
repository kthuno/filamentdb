// Filament DB adapter around the pinned Phomymo designer. No printer/API access.
import { initializeDesigner, state, render, saveHistory, resetHistory, updatePrintSize, updateToolbarState, updatePropertiesPanel, updateMobileLabelName } from './app.js';
import * as pdfjsLib from './lib/pdf.mjs';
window.pdfjsLib=pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc=new URL('./lib/pdf.worker.mjs',import.meta.url).href;
let session=null,hostOrigin=null,original=null,last='',timer;
const copy=value=>JSON.parse(JSON.stringify(value));
const send=(type,extra={})=>{if(session)parent.postMessage({channel:'filamentdb-designer',session,type,...extra},hostOrigin);};
function snapshot() {
  return {...copy(original),name:state.currentDesignName||original.name,labelSize:copy(original.labelSize),elements:copy(state.elements)};
}
function changed() {
  if(!original)return;
  const design=snapshot(),json=JSON.stringify(design);
  if(json!==last){last=json;send('changed',{design});}
}
function load(design) {
  original=copy(design);state.elements=copy(design.elements);state.labelSize=copy(design.labelSize);state.currentDesignName=design.name;
  state.templateData=[];state.templateFields=[];state.selectedIds=[];
  state.renderer.setDimensions(state.labelSize.width,state.labelSize.height,state.zoom,false);state.renderer.clearCache();
  resetHistory();updatePrintSize();updateToolbarState();updatePropertiesPanel();updateMobileLabelName();render();last=JSON.stringify(snapshot());
}
initializeDesigner();
window.addEventListener('message',event=>{
  const message=event.data;
  if(event.source!==parent||!message||message.channel!=='filamentdb-designer')return;
  if(message.type==='initialize'){
    if(session && message.session!==session)return;
    session=message.session;hostOrigin=event.origin;load(message.design);send('loaded');return;
  }
  if(message.session!==session||event.origin!==hostOrigin||!original)return;
  if(message.type==='snapshot')send('snapshot',{request:message.request,design:snapshot()});
  if(message.type==='replace')load(message.design);
  if(message.type==='insert-variable'){
    const field=document.activeElement;
    if(field && ['text','textarea'].includes(field.type)){
      const start=field.selectionStart??field.value.length,end=field.selectionEnd??start;
      field.value=field.value.slice(0,start)+message.variable+field.value.slice(end);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));
    }else {
      const element=state.elements.find(item=>state.selectedIds.includes(item.id));
      if(element?.type==='text'){element.text+=message.variable;updatePropertiesPanel();render();}
      if(element?.type==='qr'){element.qrData=message.variable;updatePropertiesPanel();render();}
    }
    saveHistory();changed();
  }
});
for(const name of ['input','change','pointerup','keyup','click'])document.addEventListener(name,()=>{clearTimeout(timer);timer=setTimeout(changed,80);},true);
parent.postMessage({channel:'filamentdb-designer',type:'ready'},'*');
