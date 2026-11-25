import { esc } from './core.js';
import { t } from './i18n.js';
import qrcodegen from './vendor/qrcodegen.js';
import { bambuLabLogo } from './vendor/bambu-lab-logo.js';
import { extendedLabelGeometry, qrArtwork, LOGO_ATTRIBUTION, isBambuBrand } from './label-style.js';

// All layout coordinates are printer dots, with QR modules on an integer grid.
const LABEL_SIZES = Object.freeze({
  '40x30': Object.freeze([40,30]),
  '60x40': Object.freeze([60,40]),
  '70x80': Object.freeze([70,80]),
});
const LABEL_DPI = 203;
function labelText(value,x,y,width,size,{bold=false,fill='black'}={}) {
  const text=String(value ?? '').replace(/[\u0000-\u001f]/g,' ').trim();
  const fit=Array.from(text).length*size*.62>width ? ` textLength="${width}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${bold?700:400}" fill="${fill}"${fit}><title>${esc(text)}</title>${esc(text)}</text>`;
}
function thermalLabel(spool,link,{size='60x40',layout='extended',nozzle='',bed='',flow='',drying=''}={}) {
  if(!Object.hasOwn(LABEL_SIZES,size) || !['extended','compact'].includes(layout))throw new Error(t('labels.invalid_options'));
  const [mmWidth,mmHeight]=LABEL_SIZES[size];
  const width=Math.round(mmWidth/25.4*LABEL_DPI), height=Math.round(mmHeight/25.4*LABEL_DPI);
  const margin=16, gap=8, contentWidth=width-2*margin;
  const headerHeight=Math.round(contentWidth/8.48);
  const headerY=margin;
  const bodyY=headerY+headerHeight+gap;
  const material=spool.material || spool.name || '—';
  const color=[spool.color,spool.product_id ? `(${spool.product_id})` : ''].filter(Boolean).join(' ') || '—';
  const hex=/^#[0-9a-f]{6}$/i.test(spool.color_hex) ? spool.color_hex.toUpperCase() : '—';
  const brand=String(spool.manufacturer || '').trim();
  const isBambu=isBambuBrand(brand);
  let content=isBambu
    ? `<svg x="${margin}" y="${headerY}" width="${contentWidth}" height="${headerHeight}" viewBox="8 22 560 66">${bambuLabLogo.slice(bambuLabLogo.indexOf('>')+1,bambuLabLogo.lastIndexOf('</svg>'))}</svg>`
    : labelText(brand,margin,headerY+headerHeight*.85,contentWidth,headerHeight*.8,{bold:true});
  let qrX,qrY,qrBox;
  if(layout==='compact') {
    qrBox=Math.floor(Math.min(contentWidth*.48,height-margin-bodyY));
    qrX=margin; qrY=bodyY;
    const x=margin+qrBox+gap, w=width-margin-x;
    const font=Math.min(30,Math.max(18,contentWidth*.065));
    content+=`<rect x="${x}" y="${bodyY}" width="${w}" height="${font+8}" fill="black"/>`;
    content+=labelText(material,x+4,bodyY+font,w-8,font,{bold:true,fill:'white'});
    content+=labelText(color,x,bodyY+font*2+12,w,font*.85);
    content+=labelText(hex,x,bodyY+qrBox-4,w,font*.75);
  } else {
    const {font,hexWidth,barWidth,lowerY,infoWidth,infoFont,qrX:extendedQrX,qrY:extendedQrY,qrBox:extendedQrBox}=extendedLabelGeometry(width,height);
    content+=`<rect x="${margin}" y="${bodyY}" width="${barWidth}" height="${font+6}" fill="black"/>`;
    content+=labelText(material,margin+4,bodyY+font,barWidth-8,font,{bold:true,fill:'white'});
    content+=labelText(hex,margin+barWidth+gap,bodyY+font-2,hexWidth,font*.55);
    // Move the color into the information column, freeing vertical space for QR.
    qrBox=extendedQrBox;qrX=extendedQrX;qrY=extendedQrY;
    content+=labelText(color,margin,lowerY+font*.85,infoWidth,font*.75);
    const rows=[
      [t('labels.nozzle'),nozzle], [t('labels.bed'),bed],
      [t('labels.flow'),flow], [t('labels.drying'),drying],
    ];
    rows.forEach(([key,value],i)=>{
      const y=height-margin-(3-i)*infoFont*1.22;
      content+=labelText(`${key}: ${value.trim() || '—'}`,margin,y,infoWidth,infoFont);
    });
  }
  let qr;
  try { qr=qrcodegen.QrCode.encodeText(link,qrcodegen.QrCode.Ecc.MEDIUM); }
  catch { throw new Error(t('labels.qr_too_dense')); }
  const moduleDots=Math.floor(qrBox/(qr.size+8));
  if(moduleDots<2)throw new Error(t('labels.qr_too_dense'));
  const qrWidth=(qr.size+8)*moduleDots;
  const x=qrX+Math.floor((qrBox-qrWidth)/2), y=qrY+Math.floor((qrBox-qrWidth)/2);
  const paths=[];
  // A circular top-left finder echoes the reference style. Keep every other
  // encoded module and the full four-module quiet zone untouched.
  for(const module of qrArtwork(qr,true).modules) {
    paths.push(`M${x+(module.x+4)*moduleDots},${y+(module.y+4)*moduleDots}h${moduleDots}v${moduleDots}h-${moduleDots}z`);
  }
  content+=`<path fill="black" shape-rendering="crispEdges" d="${paths.join('')}"/>`;
  const eyeX=x+7.5*moduleDots, eyeY=y+7.5*moduleDots;
  content+=`<g data-qr-eye="round"><circle cx="${eyeX}" cy="${eyeY}" r="${3.5*moduleDots}" fill="black"/><circle cx="${eyeX}" cy="${eyeY}" r="${2.5*moduleDots}" fill="white"/><circle cx="${eyeX}" cy="${eyeY}" r="${1.5*moduleDots}" fill="black"/></g>`;
  const attribution=isBambu ? LOGO_ATTRIBUTION : '';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${mmWidth}mm" height="${mmHeight}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(t('labels.preview'))}" font-family="Arial, Helvetica, sans-serif"><title>${esc(spool.name || material)}</title><metadata>${esc(attribution)}</metadata><rect width="${width}" height="${height}" fill="white"/>${content}</svg>`;
  return {svg,width,height,mmWidth,mmHeight,moduleDots,qrWidth};
}

async function labelPng(label) {
  const canvas=document.createElement('canvas');
  canvas.width=label.width; canvas.height=label.height;
  const context=canvas.getContext('2d');
  if(!context)throw new Error(t('labels.download_error'));
  const url=URL.createObjectURL(new Blob([label.svg],{type:'image/svg+xml;charset=utf-8'}));
  try {
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
    context.drawImage(image,0,0,label.width,label.height);
    // Threshold text antialiasing too: exported PNG has only opaque black/white.
    const pixels=context.getImageData(0,0,label.width,label.height);
    for(let i=0;i<pixels.data.length;i+=4) {
      const value=pixels.data[i]<160?0:255;
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;
      pixels.data[i+3]=255;
    }
    context.putImageData(pixels,0,0);
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error(t('labels.download_error'))),'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

export { LABEL_SIZES, thermalLabel, labelPng };
