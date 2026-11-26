import { BARCODE_FORMATS, barcodeEncoding } from './barcode-renderer.js';
import { PRINT_PRESETS } from './printer-definitions.js';
import { PrinterError } from './printer-transport.js';
import { BAMBU_LOGO_IMAGE, LOGO_ATTRIBUTION, isBambuBrand, extendedLabelGeometry } from './label-style.js';

export const DESIGN_LIMIT=1024*1024;
function isLabelColor(value) {
  if(value==null)return true;
  if(typeof value!=='string')return false;
  if(/^(black|white|transparent|none|#[0-9a-f]{6})$/i.test(value))return true;
  const rgb=value.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  return Boolean(rgb && rgb.slice(1).every(channel=>Number(channel)<=255));
}
export function validateDesign(value) {
  const invalid=()=>{throw new PrinterError('invalid_design');};
  if(!value || value.version!==3 || typeof value.name!=='string' || value.name.length>200 || !value.labelSize || !Object.values(PRINT_PRESETS).some(([w,h])=>value.labelSize.width===w && value.labelSize.height===h) || !Array.isArray(value.elements) || value.elements.length>100 || value.multiLabel?.enabled || value.isTemplate)invalid();
  const ids=new Set();
  for(const element of value.elements) {
    if(!element || !['text','image','shape','qr','barcode'].includes(element.type) || typeof element.id!=='string' || ids.has(element.id) || (element.zone!=null && element.zone!==0))invalid();
    ids.add(element.id);
    for(const field of ['x','y','width','height'])if(!Number.isFinite(element[field]) || Math.abs(element[field])>1000)invalid();
    if(element.width<1 || element.height<1 || (element.rotation!=null && (!Number.isFinite(element.rotation)||Math.abs(element.rotation)>360)))invalid();
    if(!isLabelColor(element.color)||!isLabelColor(element.fill)||!isLabelColor(element.stroke)||!isLabelColor(element.background))invalid();
    if(element.type==='text') {
      if(typeof element.text!=='string'||element.text.length>5000 || !Number.isFinite(element.fontSize)||element.fontSize<1||element.fontSize>200)invalid();
      if(element.fontFamily!=null && !/^[a-zA-Z ,'-]{1,100}$/.test(element.fontFamily))invalid();
      if(element.align!=null && !['left','center','right'].includes(element.align))invalid();
      if(element.verticalAlign!=null && !['top','middle','bottom'].includes(element.verticalAlign))invalid();
    }
    if(element.type==='barcode') {
      if(typeof element.barcodeData!=='string'||element.barcodeData.length>500 || !BARCODE_FORMATS.includes(element.barcodeFormat||'CODE128') || (element.textFontSize!=null&&(!Number.isFinite(element.textFontSize)||element.textFontSize<1||element.textFontSize>200)))invalid();
      barcodeEncoding(element);
    }
    if(element.type==='qr' && (typeof element.qrData!=='string' || !element.qrData || element.qrData.length>2953))invalid();
    if(element.type==='qr' && (element.rotation||0)%90!==0)invalid();
    if(element.type==='qr' && element.errorCorrection!=null && !['L','M','Q','H'].includes(element.errorCorrection))invalid();
    if(element.type==='image' && (typeof element.imageData!=='string' || (!/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=\r\n]+$/.test(element.imageData) && element.imageData!==BAMBU_LOGO_IMAGE) || element.imageData.length>700000))invalid();
    if(element.type==='qr' && element.finderStyle!=null && !['square','round-top-left'].includes(element.finderStyle))invalid();
    if(element.type==='image' && (['brightness','contrast'].some(key=>element[key]!=null&&(!Number.isFinite(element[key])||Math.abs(element[key])>100)) || (element.dither!=null && !['none','threshold','floyd-steinberg','atkinson','ordered','auto'].includes(element.dither))))invalid();
    if(element.type==='shape' && !['rectangle','ellipse','triangle','line'].includes(element.shapeType))invalid();
    for(const field of ['strokeWidth','cornerRadius'])if(element[field]!=null && (!Number.isFinite(element[field]) || element[field]<0 || element[field]>100))invalid();
  }
  return value;
}
export function importDesign(json) {
  if(typeof json!=='string' || json.length>DESIGN_LIMIT)throw new PrinterError('invalid_design');
  try { return validateDesign(JSON.parse(json)); }
  catch { throw new PrinterError('invalid_design'); }
}
export function exportDesign(design) {
  validateDesign(design);
  const text=JSON.stringify(design,null,2);
  if(text.length>DESIGN_LIMIT)throw new PrinterError('invalid_design');
  return text;
}
export function cloneDesign(design) { return importDesign(exportDesign(design)); }
export function resizeDesign(design,size) {
  if(!Object.hasOwn(PRINT_PRESETS,size))throw new PrinterError('invalid_design');
  const result=cloneDesign(design),[width,height]=PRINT_PRESETS[size];
  const sx=width/result.labelSize.width,sy=height/result.labelSize.height;
  for(const element of result.elements) {
    element.x=Math.round(element.x*sx);element.y=Math.round(element.y*sy);
    element.width=Math.max(1,Math.round(element.width*sx));element.height=Math.max(1,Math.round(element.height*sy));
    if(element.fontSize)element.fontSize=Math.max(6,Math.round(element.fontSize*Math.min(sx,sy)));
    if(element.type==='qr')element.width=element.height=Math.min(element.width,element.height);
  }
  result.labelSize={width,height};return validateDesign(result);
}
export function newElement(type,id) {
  const base={id,type,zone:0,x:16,y:16,width:120,height:32,rotation:0};
  if(type==='text')return {...base,text:'',fontSize:22,color:'black',align:'left',verticalAlign:'middle',fontFamily:'Arial, sans-serif',noWrap:true};
  if(type==='qr')return {...base,width:120,height:120,qrData:'',finderStyle:'round-top-left'};
  if(type==='shape')return {...base,shapeType:'rectangle',fill:'black',stroke:'none',strokeWidth:0};
  return {...base,width:64,height:64,imageData:''};
}
export function spoolDesign(spool,link,profile={},text={}) {
  const size=Object.hasOwn(PRINT_PRESETS,profile.size)?profile.size:'70x80';
  const [mmWidth,mmHeight]=PRINT_PRESETS[size],width=mmWidth*8,height=mmHeight*8;
  const g=extendedLabelGeometry(width,height),elements=[];
  const addText=(id,value,x,y,w,h,fontSize,extra={})=>elements.push({
    ...newElement('text',id),text:String(value),x,y,width:w,height:h,fontSize,
    clipOverflow:true,autoScale:true,shrinkToFit:true,...extra,
  });
  if(isBambuBrand(spool.manufacturer))elements.push({...newElement('image','brand'),x:g.margin,y:g.headerY,width:g.contentWidth,height:g.headerHeight,imageData:BAMBU_LOGO_IMAGE,imageAttribution:LOGO_ATTRIBUTION});
  else addText('brand',spool.manufacturer||'',g.margin,g.headerY,g.contentWidth,g.headerHeight,g.headerHeight*.8,{fontWeight:'bold'});
  addText('material',spool.material||spool.name||'—',g.margin,g.bodyY,g.barWidth,g.font+6,g.font,{fontWeight:'bold',color:'white',background:'black'});
  const hex=/^#[0-9a-f]{6}$/i.test(spool.color_hex)?spool.color_hex.toUpperCase():'—';
  addText('color-hex',hex,g.margin+g.barWidth+g.gap,g.bodyY,g.hexWidth,g.font+6,g.font*.55);
  const color=[spool.color,spool.product_id?'('+spool.product_id+')':''].filter(Boolean).join(' ')||'—';
  addText('color',color,g.margin,g.lowerY,g.infoWidth,g.font,g.font*.75);
  for(const [i,key] of ['nozzle','bed','flow','drying'].entries()) {
    const value=String(profile[key]||'').trim()||'—';
    const baseline=height-g.margin-(3-i)*g.infoFont*1.22;
    addText(key,(text[key]||'')+': '+value,g.margin,baseline-g.infoFont,g.infoWidth,g.infoFont*1.2,g.infoFont);
  }
  elements.push({...newElement('qr','qr'),x:g.qrX,y:g.qrY,width:g.qrBox,height:g.qrBox,qrData:link,finderStyle:'round-top-left'});
  return validateDesign({name:String(spool.name||spool.material||'Filament DB').slice(0,200),version:3,labelSize:{width:mmWidth,height:mmHeight},elements});
}
