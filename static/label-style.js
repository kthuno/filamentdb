import { bambuLabLogo } from './vendor/bambu-lab-logo.js';

export const LOGO_ATTRIBUTION='Logo: Lwde, CC BY-SA 4.0, https://commons.wikimedia.org/wiki/File:BambuLab_logo.svg; monochrome horizontal adaptation; https://creativecommons.org/licenses/by-sa/4.0/';
// Exact bundled artwork only: imported arbitrary SVG remains prohibited.
export const BAMBU_LOGO_IMAGE='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(bambuLabLogo.replace('<svg ','<svg width="560" height="66" ').replace('</svg>','<metadata>'+LOGO_ATTRIBUTION+'</metadata></svg>'));
export function isBambuBrand(value) { return /^bambu(?:\s*lab)?$/i.test(String(value||'').trim()); }
export function extendedLabelGeometry(width,height) {
  const margin=16,gap=8,contentWidth=width-2*margin,headerHeight=Math.round(contentWidth/8.48),headerY=margin;
  const bodyY=headerY+headerHeight+gap,font=Math.min(32,Math.max(19,contentWidth*.065));
  const hexWidth=Math.ceil(font*.55*7*.65)+8,barWidth=contentWidth-hexWidth-gap,lowerY=bodyY+font+10;
  const lowerHeight=height-margin-lowerY,qrBox=Math.floor(Math.min(contentWidth*.56,lowerHeight));
  const qrX=width-margin-qrBox,qrY=height-margin-qrBox,infoWidth=qrX-margin-gap;
  const infoFont=Math.min(22,Math.max(11,infoWidth*.075),lowerHeight/5.1);
  return {margin,gap,contentWidth,headerHeight,headerY,bodyY,font,hexWidth,barWidth,lowerY,qrBox,qrX,qrY,infoWidth,infoFont};
}
export function qrArtwork(qr,roundTopLeft=false) {
  const modules=[];
  for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y) && !(roundTopLeft && x<7 && y<7))modules.push({x,y});
  return {modules,circles:roundTopLeft?[{radius:3.5,fill:'black'},{radius:2.5,fill:'white'},{radius:1.5,fill:'black'}]:[]};
}
