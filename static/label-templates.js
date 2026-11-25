import { PRINT_PRESETS } from './printer-definitions.js';
import { DESIGN_LIMIT, validateDesign, spoolDesign } from './label-design.js';
import { PrinterError } from './printer-transport.js';

export const TEMPLATE_VARIABLES=Object.freeze(['spoolid','spoolnumber','filamentname','filamenttype','manufacturer','filamentcolor','filamentcolorrgb','filamentcolorname','productid','producturl','diameter','weight','remainingweight','location','activeslot','notes','nozzletemperature','bedtemperature','flowratio','drying','qrurl','labelwidth','labelheight','appversion']);
const templateNames=new Set(TEMPLATE_VARIABLES);
const templateFields=new Set(['text','qrData','color','background','fill','stroke']);
const templatePrefix='filamentdb.label-template.';
let sharedTemplateRecords=null;
let templateAppVersion='—';
export function setSharedLabelTemplates(records,appVersion='—') {
  if(!Array.isArray(records))throw templateError('template_database_failed');
  const next=new Map();
  for(const record of records) {
    if(!Object.hasOwn(PRINT_PRESETS,record.size) || next.has(record.size) || typeof record.revision!=='string' || !record.revision)throw templateError('template_database_failed');
    next.set(record.size,{...record,design:importLabelTemplate(JSON.stringify(record.design),record.size)});
  }
  sharedTemplateRecords=next;
  templateAppVersion=typeof appVersion==='string' && appVersion?appVersion:'—';
}
function templateStorage() {try {return globalThis.localStorage;}catch {return undefined;}}
function templateError(code,variable='') {const error=new PrinterError(code);error.variable=variable;return error;}
function templateCopy(value) { return JSON.parse(JSON.stringify(value)); }
function templateTokens(value) {return [...value.matchAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)\$/g)];}
function templateSize(design) {return design?.labelSize?.width+'x'+design?.labelSize?.height;}
function checkTemplateTokens(value,path=[]) {
  if(typeof value==='string') {
    const tokens=templateTokens(value);if(!tokens.length)return;
    const allowed=path.length===1 && path[0]==='name' || path.length===3 && path[0]==='elements' && templateFields.has(path[2]);
    if(!allowed)throw templateError('template_invalid');
    for(const token of tokens)if(!templateNames.has(token[1]))throw templateError('template_unknown_variable',token[1]);
  } else if(Array.isArray(value))value.forEach((item,index)=>checkTemplateTokens(item,[...path,index]));
  else if(value && typeof value==='object')for(const [key,item] of Object.entries(value))checkTemplateTokens(item,[...path,key]);
}
export function labelTemplateVariables(spool,link,profile={},size='70x80') {
  if(!Object.hasOwn(PRINT_PRESETS,size))throw templateError('template_invalid');
  const color=/^#[0-9a-f]{6}$/i.test(spool.color_hex)?spool.color_hex.toUpperCase():'#000000';
  const channels=[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16));
  const numeric=value=>value!=null && value!=='' && Number.isFinite(Number(value))?String(Number(value)):'';
  const temperature=(field,value)=>profile[field]!=null?String(profile[field])||'—':Number(value)>0?numeric(value)+'°C':'—';
  return Object.freeze({
    spoolid:String(spool.id??''),spoolnumber:String(spool.id??'').padStart(4,'0'),
    filamentname:String(spool.name||''),filamenttype:String(spool.material||''),manufacturer:String(spool.manufacturer||''),
    filamentcolor:color,filamentcolorrgb:'rgb('+channels.join(', ')+')',filamentcolorname:String(spool.color||''),
    productid:String(spool.product_id||''),producturl:String(spool.product_url||''),diameter:numeric(spool.diameter),
    weight:numeric(spool.weight),remainingweight:numeric(spool.remaining),location:String(spool.location||''),activeslot:String(spool.active_slot||''),notes:String(spool.notes||''),
    nozzletemperature:temperature('nozzle',spool.nozzle_temp),bedtemperature:temperature('bed',spool.bed_temp),
    flowratio:profile.flow!=null && String(profile.flow)!==''?String(profile.flow):'—',drying:profile.drying!=null && String(profile.drying)!==''?String(profile.drying):'—',
    appversion:templateAppVersion,qrurl:String(link),labelwidth:String(PRINT_PRESETS[size][0]),labelheight:String(PRINT_PRESETS[size][1]),
  });
}
export function instantiateLabelTemplate(template,spool,link,profile={}) {
  try {
    checkTemplateTokens(template);
    const design=templateCopy(template),size=templateSize(design),values=labelTemplateVariables(spool,link,profile,size);
    const replace=value=>value.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)\$/g,(_,key)=>values[key]);
    if(typeof design.name==='string')design.name=replace(design.name).slice(0,200);
    delete design.isTemplate;
    for(const element of design.elements||[])for(const field of templateFields)if(typeof element[field]==='string')element[field]=replace(element[field]);
    try {return validateDesign(design);}catch {throw templateError('template_invalid');}
  }catch(error){throw error instanceof PrinterError?error:templateError('template_invalid');}
}
export function importLabelTemplate(json,size) {
  try {
    if(typeof json!=='string'||json.length>DESIGN_LIMIT || !Object.hasOwn(PRINT_PRESETS,size))throw templateError('template_invalid');
    let template;
    try {template=JSON.parse(json);}catch {throw templateError('template_invalid');}
    if(!template || typeof template!=='object' || Array.isArray(template) || typeof template.name!=='string' || template.name.length>200 || !Array.isArray(template.elements))throw templateError('template_invalid');
    if(templateSize(template)!==size)throw templateError('template_size_mismatch');
    if(template.isTemplate!=null && typeof template.isTemplate!=='boolean')throw templateError('template_invalid');
    checkTemplateTokens(template);
    instantiateLabelTemplate(template,{id:42,name:'Example spool',material:'PLA Matte',manufacturer:'Example',color:'Blue',color_hex:'#0000FF',diameter:1.75,weight:1000,remaining:500},'https://filament.example/#spool/example',{nozzle:'190–230°C',bed:'55–65°C',flow:'0.98',drying:'50°C/8h'});
    return template;
  }catch(error){throw error instanceof PrinterError?error:templateError('template_invalid');}
}
export function readLabelTemplate(size,storage) {
  if(!Object.hasOwn(PRINT_PRESETS,size))throw templateError('template_invalid');
  if(storage===undefined) {
    if(!sharedTemplateRecords)throw templateError('template_database_failed');
    return sharedTemplateRecords.get(size)||null;
  }
  let json;
  try {json=storage?.getItem(templatePrefix+size);}catch {throw templateError('template_storage_failed');}
  if(!json)return null;
  try {
    const record=JSON.parse(json);
    if(record.version!==1 || typeof record.revision!=='string' || !record.revision || record.revision.length>100)throw new Error();
    return {...record,design:importLabelTemplate(JSON.stringify(record.design),size)};
  }catch(error){throw error instanceof PrinterError?error:templateError('template_invalid');}
}
export function saveLabelTemplate(size,json,storage) {
  const design=importLabelTemplate(json,size);
  const record={version:1,revision:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),design};
  try {if(!storage)throw new Error();storage.setItem(templatePrefix+size,JSON.stringify(record));}
  catch {throw templateError('template_storage_failed');}
  return record;
}
export function removeLabelTemplate(size,storage) {
  if(!Object.hasOwn(PRINT_PRESETS,size))throw templateError('template_invalid');
  try {if(!storage)throw new Error();storage.removeItem(templatePrefix+size);}catch {throw templateError('template_storage_failed');}
}
export function preferredLabelSize(storage) {
  try {const preferred=(storage||templateStorage())?.getItem('filamentdb.native-label-size');if(Object.hasOwn(PRINT_PRESETS,preferred))return preferred;}catch {}
  for(const size of ['70x80','60x40','40x30'])try {if(readLabelTemplate(size,storage))return size;}catch {}
  return '70x80';
}
export function labelTemplateOrigin(record,spool,link,profile={}) {
  const resolved=instantiateLabelTemplate(record.design,spool,link,profile),bindings={elements:[]};
  if(templateTokens(record.design.name).length)bindings.name=resolved.name;
  for(const element of record.design.elements) {
    const values=[];
    for(const field of templateFields)if(typeof element[field]==='string' && templateTokens(element[field]).length)values.push({field,value:resolved.elements.find(item=>item.id===element.id)[field]});
    if(values.length)bindings.elements.push({id:element.id,values});
  }
  return {size:templateSize(record.design),revision:record.revision,bindings};
}
export function restoreTemplateDesign(saved,fresh) {
  const restored=templateCopy(saved),previous=saved.filamentdbTemplate?.bindings,current=fresh.filamentdbTemplate?.bindings;
  if(previous && current) {
    if(previous.name!=null && saved.name===previous.name)restored.name=fresh.name;
    for(const binding of current.elements) {
      const old=previous.elements?.find(item=>item.id===binding.id),element=restored.elements.find(item=>item.id===binding.id);
      if(!old || !element)continue;
      for(const {field,value} of binding.values)if(templateFields.has(field)) {
        const prior=old.values?.find(item=>item.field===field);
        if(prior && element[field]===prior.value)element[field]=value;
      }
    }
  }
  restored.filamentdbTemplate=fresh.filamentdbTemplate;
  return validateDesign(restored);
}
export function createSpoolLabel(spool,link,profile={},text={},storage) {
  const size=Object.hasOwn(PRINT_PRESETS,profile.size)?profile.size:preferredLabelSize(storage);
  const template=readLabelTemplate(size,storage);
  const design=template?instantiateLabelTemplate(template.design,spool,link,profile):spoolDesign(spool,link,{...profile,size},text);
  if(template)design.filamentdbTemplate=labelTemplateOrigin(template,spool,link,profile);
  return {design,template};
}
export function exampleLabelTemplate(size) {
  if(!Object.hasOwn(PRINT_PRESETS,size))throw templateError('template_invalid');
  const [w,h]=PRINT_PRESETS[size].map(mm=>mm*8),margin=16;
  const text=(id,value,x,y,width,height,fontSize,extra={})=>({id,type:'text',x,y,width,height,rotation:0,text:value,fontSize,fontFamily:'Arial, sans-serif',align:'left',verticalAlign:'middle',noWrap:true,autoScale:true,shrinkToFit:true,...extra});
  const qrSize=Math.min(160,h-128),qrX=w-margin-qrSize;
  return {name:'$filamentname$ · '+size,version:3,labelSize:{width:w/8,height:h/8},elements:[
    text('manufacturer','$manufacturer$',margin,margin,w-2*margin,28,24,{fontWeight:'bold'}),
    text('material','$filamenttype$',margin,50,w-2*margin,32,26,{color:'white',background:'black',fontWeight:'bold'}),
    text('color','$filamentcolorname$ · $filamentcolor$',margin,86,w-2*margin,24,18),
    text('spool','#$spoolnumber$',margin,h-70,qrX-margin-8,24,18),
    text('weight','$remainingweight$ / $weight$ g',margin,h-42,qrX-margin-8,22,14),
    {id:'qr',type:'qr',x:qrX,y:h-margin-qrSize,width:qrSize,height:qrSize,rotation:0,qrData:'$qrurl$',finderStyle:'round-top-left'},
  ]};
}
