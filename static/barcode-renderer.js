import JsBarcode from './vendor/barcode.js';
import { PrinterError } from './printer-transport.js';
export const BARCODE_FORMATS=Object.freeze(['CODE128','CODE128A','CODE128B','CODE128C','EAN13','EAN8','EAN5','EAN2','UPC','UPCE','CODE39','ITF14','ITF','MSI','MSI10','MSI11','MSI1010','MSI1110','pharmacode','codabar']);
export function barcodeEncoding(element) {
  try {
    const target={};JsBarcode(target,element.barcodeData,{format:element.barcodeFormat||'CODE128',displayValue:false});
    return target.encodings;
  }catch {throw new PrinterError('invalid_design');}
}
export function drawBarcode(ctx,element,width,height) {
  const encodings=barcodeEncoding(element),bits=encodings.map(item=>item.data).join(''),dot=Math.floor(width/(bits.length+20));
  if(dot<1)throw new PrinterError('barcode_too_dense');
  const showText=element.showText!==false,font=element.textFontSize||12,barHeight=height-(showText?font+8:0);
  if(barHeight<1)throw new PrinterError('invalid_design');
  const left=-Math.floor(bits.length*dot/2),top=-height/2;
  ctx.fillStyle='white';ctx.fillRect(-width/2,-height/2,width,height);ctx.fillStyle='black';
  for(let i=0;i<bits.length;i++)if(bits[i]==='1')ctx.fillRect(left+i*dot,top,dot,barHeight);
  if(showText){ctx.font=(element.textBold?'bold ':'')+font+'px monospace';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(encodings.map(item=>item.text).join(''),0,height/2);}
}
