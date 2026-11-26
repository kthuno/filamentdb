import { drawBarcode } from './barcode-renderer.js';
import { monochromePixels, previewPixels } from './label-raster.js';
import { validateDesign } from './label-design.js';
import { PrinterError } from './printer-transport.js';
import qrcodegen from './vendor/qrcodegen.js';
import { qrArtwork } from './label-style.js';
// Text layout adapted from Phomymo canvas.js at 1f58d3f0e7f941b9143277cda828380149e56855 (MIT).
// See vendor/phomymo-NOTICE.txt. Editor handles, global libraries and caches are excluded.
class TextRenderer {
  constructor(ctx) { this.ctx=ctx; }
  renderTextElement(element, width, height) {
    const { text, fontSize, color, align, verticalAlign, fontFamily, fontWeight, fontStyle, textDecoration, background, noWrap, clipOverflow, autoScale } = element;

    // Draw background if not transparent
    if (background && background !== 'transparent') {
      this.ctx.fillStyle = background;
      this.ctx.fillRect(-width / 2, -height / 2, width, height);
    }

    if (!text || !text.trim()) return;

    // Set up clipping region if clipOverflow is enabled
    if (clipOverflow) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(-width / 2, -height / 2, width, height);
      this.ctx.clip();
    }

    // Set text color - use explicit color property, default to black
    const textColor = color || 'black';
    this.ctx.fillStyle = textColor;

    // Calculate effective font size (auto-scale if enabled)
    let effectiveFontSize = fontSize;
    if (autoScale) {
      effectiveFontSize = this.calculateAutoScaleFontSize(text, width, height, fontFamily, fontWeight, fontStyle, noWrap);
      if(element.shrinkToFit)effectiveFontSize=Math.min(effectiveFontSize,fontSize);
    }

    // Build font string with weight and style
    const weight = fontWeight === 'bold' ? 'bold' : '';
    const style = fontStyle === 'italic' ? 'italic' : '';
    const fontStr = `${style} ${weight} ${effectiveFontSize}px ${fontFamily || 'Inter, sans-serif'}`.trim();
    this.ctx.font = fontStr;
    this.ctx.textBaseline = 'middle';

    // Set text alignment
    let textX = 0;
    if (align === 'left') {
      this.ctx.textAlign = 'left';
      textX = -width / 2 + 4;
    } else if (align === 'right') {
      this.ctx.textAlign = 'right';
      textX = width / 2 - 4;
    } else {
      this.ctx.textAlign = 'center';
    }

    // Get lines - either wrapped or split by newlines only
    let lines;
    if (noWrap) {
      // No wrap mode: only split by explicit newlines, allow overflow
      lines = text.split('\n');
    } else {
      // Word wrap mode
      lines = this.wrapText(text, width - 8, effectiveFontSize, fontFamily, fontWeight, fontStyle);
    }

    const lineHeight = effectiveFontSize * 1.2;
    const totalHeight = lines.length * lineHeight;

    // Calculate vertical start position based on alignment
    let textY;
    const vAlign = verticalAlign || 'middle';
    if (vAlign === 'top') {
      textY = -height / 2 + lineHeight / 2 + 2; // 2px padding from top
    } else if (vAlign === 'bottom') {
      textY = height / 2 - totalHeight + lineHeight / 2 - 2; // 2px padding from bottom
    } else {
      // middle (default) - center text block within element bounds
      textY = -totalHeight / 2 + lineHeight / 2;
    }

    // When autoScale is enabled, adjust vertical position to maintain baseline alignment
    if (autoScale) {
      const unusedSpace = height - totalHeight;
      const unusedRatio = unusedSpace / height;
      if (unusedRatio > 0.4) {
        // Text was scaled down significantly - shift up
        const adjustment = unusedSpace * 0.08;
        textY -= adjustment;
      } else {
        // Text was not scaled down much - shift down to match non-autoScale position
        // Adjustment varies by vertical alignment
        if (vAlign === 'bottom') {
          textY += 1;
        } else if (vAlign === 'top') {
          textY += 0;
        } else {
          // middle
          textY += 0.5;
        }
      }
    }

    for (const line of lines) {
      this.ctx.fillText(line, textX, textY);

      // Draw underline manually if enabled
      if (textDecoration === 'underline') {
        const metrics = this.ctx.measureText(line);
        // Position underline below text - since textBaseline is 'middle',
        // the bottom of the text is at textY + effectiveFontSize/2, add small gap
        const underlineY = textY + effectiveFontSize * 0.45;
        let underlineX;
        let underlineWidth = metrics.width;

        if (align === 'left') {
          underlineX = textX;
        } else if (align === 'right') {
          underlineX = textX - underlineWidth;
        } else {
          underlineX = -underlineWidth / 2;
        }

        this.ctx.beginPath();
        this.ctx.strokeStyle = textColor;
        this.ctx.lineWidth = Math.max(1, effectiveFontSize / 16);
        this.ctx.moveTo(underlineX, underlineY);
        this.ctx.lineTo(underlineX + underlineWidth, underlineY);
        this.ctx.stroke();
      }

      textY += lineHeight;
    }

    // Restore context if we applied clipping
    if (clipOverflow) {
      this.ctx.restore();
    }
  }

  calculateAutoScaleFontSize(text, width, height, fontFamily, fontWeight, fontStyle, noWrap) {
    const padding = 8; // 4px on each side
    const availableWidth = width - padding;
    const availableHeight = height - padding;

    if (availableWidth <= 0 || availableHeight <= 0) return 8;

    const weight = fontWeight === 'bold' ? 'bold' : '';
    const style = fontStyle === 'italic' ? 'italic' : '';

    // Binary search for optimal font size
    let minSize = 6;
    let maxSize = 200;
    let bestSize = minSize;

    while (minSize <= maxSize) {
      const testSize = Math.floor((minSize + maxSize) / 2);
      const fontStr = `${style} ${weight} ${testSize}px ${fontFamily || 'Inter, sans-serif'}`.trim();
      this.ctx.font = fontStr;

      let fits = false;

      if (noWrap) {
        // For no-wrap, check if all lines fit
        const lines = text.split('\n');
        const lineHeight = testSize * 1.2;
        const totalHeight = lines.length * lineHeight;

        // Check width of longest line
        let maxLineWidth = 0;
        for (const line of lines) {
          const metrics = this.ctx.measureText(line);
          maxLineWidth = Math.max(maxLineWidth, metrics.width);
        }

        fits = maxLineWidth <= availableWidth && totalHeight <= availableHeight;
      } else {
        // For wrapped text, check if text fits with wrapping
        const lines = this.wrapText(text, availableWidth, testSize, fontFamily, fontWeight, fontStyle);
        const lineHeight = testSize * 1.2;
        const totalHeight = lines.length * lineHeight;

        fits = totalHeight <= availableHeight;
      }

      if (fits) {
        bestSize = testSize;
        minSize = testSize + 1;
      } else {
        maxSize = testSize - 1;
      }
    }

    return Math.max(bestSize, 6); // Minimum 6px
  }

  wrapText(text, maxWidth, fontSize, fontFamily = 'Inter, sans-serif', fontWeight = 'normal', fontStyle = 'normal') {
    const weight = fontWeight === 'bold' ? 'bold' : '';
    const style = fontStyle === 'italic' ? 'italic' : '';
    this.ctx.font = `${style} ${weight} ${fontSize}px ${fontFamily}`.trim();

    const lines = [];

    // First split by explicit newlines to preserve them
    const paragraphs = text.split('\n');

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) {
        // Empty line - preserve it
        lines.push('');
        continue;
      }

      // Word wrap within each paragraph
      const words = paragraph.split(/[ \t]+/); // Split by spaces/tabs only, not newlines
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = this.ctx.measureText(testLine);

        if (metrics.width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }
    }

    return lines.length ? lines : [''];
  }


}
async function decodeImage(source) {
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>{if(image.naturalWidth*image.naturalHeight>4000000)reject(new PrinterError('invalid_image'));else resolve(image);};
    image.onerror=()=>reject(new PrinterError('invalid_image'));
    image.src=source;
  });
}
export async function renderDesign(design,{makeCanvas=()=>document.createElement('canvas'),loadImage=decodeImage}={}) {
  validateDesign(design);
  const canvas=makeCanvas(),width=design.labelSize.width*8,height=design.labelSize.height*8;
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new PrinterError('invalid_image');
  ctx.fillStyle='white';ctx.fillRect(0,0,width,height);
  const textRenderer=new TextRenderer(ctx),qrRegions=[];
  for(const element of design.elements) {
    const {x,y,width:w,height:h,type}=element;
    let image;
    if(type==='image')image=await loadImage(element.imageData);
    ctx.save();
    try {
      ctx.translate(x+w/2,y+h/2);
      ctx.rotate((element.rotation||0)*Math.PI/180);
      if(type==='text')textRenderer.renderTextElement(element,w,h);
      if(type==='image') {
        const mode=element.dither==='auto'?'floyd-steinberg':element.dither||'none',filtered=Boolean(element.brightness||element.contrast||!['none','auto'].includes(mode));
        if(filtered){
          const adjusted=makeCanvas();adjusted.width=Math.max(1,Math.round(w));adjusted.height=Math.max(1,Math.round(h));const target=adjusted.getContext('2d');
          target.fillStyle='white';target.fillRect(0,0,adjusted.width,adjusted.height);
          target.filter=`brightness(${1+(element.brightness||0)/100}) contrast(${1+(element.contrast||0)/100})`;
          target.drawImage(image,0,0,adjusted.width,adjusted.height);target.filter='none';
          if(!['none','auto'].includes(mode)){
            const pixels=target.getImageData(0,0,adjusted.width,adjusted.height),dots=monochromePixels(pixels.data,adjusted.width,adjusted.height,mode);pixels.data.set(previewPixels(dots));target.putImageData(pixels,0,0);
          }
          ctx.drawImage(adjusted,-w/2,-h/2,w,h);
        }else ctx.drawImage(image,-w/2,-h/2,w,h);
      }
      if(type==='barcode')drawBarcode(ctx,element,w,h);
      if(type==='qr') {
        const sideways=Math.abs((element.rotation||0)%180)===90;
        qrRegions.push({x:x+(w-(sideways?h:w))/2,y:y+(h-(sideways?w:h))/2,width:sideways?h:w,height:sideways?w:h});
        const level=qrcodegen.QrCode.Ecc[element.errorCorrection==='L'?'LOW':element.errorCorrection==='Q'?'QUARTILE':element.errorCorrection==='H'?'HIGH':'MEDIUM'];
        let qr;
        try {qr=qrcodegen.QrCode.encodeText(element.qrData,level);}catch {throw new PrinterError('qr_too_dense');}
        const side=Math.floor(Math.min(w,h)),cells=qr.size+2;
        if(Math.floor(side/cells)<2)throw new PrinterError('qr_too_dense');
        // Match Phomymo's one-module margin and fill the requested QR square.
        // Snap each module boundary, rather than shrinking every module to the
        // same integer size and leaving a large unused border.
        const left=-w/2+Math.floor((w-side)/2),top=-h/2+Math.floor((h-side)/2);
        const edge=value=>Math.floor(value*side/cells),dot=side/cells;
        ctx.fillStyle='white';ctx.fillRect(-w/2,-h/2,w,h);ctx.fillStyle='black';
        const artwork=qrArtwork(qr,element.finderStyle==='round-top-left');
        for(const {x,y} of artwork.modules)ctx.fillRect(left+edge(x+1),top+edge(y+1),edge(x+2)-edge(x+1),edge(y+2)-edge(y+1));
        for(const circle of artwork.circles) {
          ctx.beginPath();ctx.fillStyle=circle.fill;
          ctx.ellipse(left+4.5*dot,top+4.5*dot,circle.radius*dot,circle.radius*dot,0,0,Math.PI*2);ctx.fill();
        }
      }
      if(type==='shape') {
        ctx.beginPath();const left=-w/2,top=-h/2;
        if(element.shapeType==='ellipse')ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);
        else if(element.shapeType==='triangle'){ctx.moveTo(0,top);ctx.lineTo(w/2,h/2);ctx.lineTo(left,h/2);ctx.closePath();}
        else if(element.shapeType==='line'){ctx.moveTo(left,0);ctx.lineTo(w/2,0);}
        else if(element.cornerRadius && ctx.roundRect)ctx.roundRect(left,top,w,h,Math.min(element.cornerRadius,w/2,h/2));
        else ctx.rect(left,top,w,h);
        if(element.fill && !['none','transparent'].includes(element.fill) && element.shapeType!=='line'){ctx.fillStyle=element.fill;ctx.fill();}
        if(element.stroke && !['none','transparent'].includes(element.stroke) && element.strokeWidth>0){ctx.strokeStyle=element.stroke;ctx.lineWidth=element.strokeWidth;ctx.stroke();}
      }
    } finally { ctx.restore(); }
  }
  return {canvas,width,height,pixels:ctx.getImageData(0,0,width,height).data,qrRegions};
}

