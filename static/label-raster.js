import { PrinterError } from './printer-transport.js';
// Adapted from Phomymo by transcriptionstream and contributors (MIT, as confirmed by the project owner).
// Upstream: 1f58d3f0e7f941b9143277cda828380149e56855, src/web/canvas.js.
// See vendor/phomymo-NOTICE.txt for origin, license evidence, and modifications.
class RasterAlgorithms {
  _rgbaToGrayscale(pixels, width, height, gamma = 1.3) {
    const grayscale = new Float32Array(width * height);
    const gammaInv = 1.0 / gamma;

    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];

      // Perceptual grayscale (ITU-R BT.601)
      let gray = 0.299 * r + 0.587 * g + 0.114 * b;

      // Handle transparency - blend with white background
      if (a < 255) {
        gray = gray * (a / 255) + 255 * (1 - a / 255);
      }

      // Apply gamma correction to lift midtones for thermal printing
      gray = 255 * Math.pow(gray / 255, gammaInv);

      grayscale[i] = gray;
    }

    return grayscale;
  }

  /**
   * Apply Floyd-Steinberg dithering to grayscale image
   * Produces high-quality 1-bit output that simulates grayscale through dot patterns
   * @param {Float32Array} grayscale - Grayscale values 0-255
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {Uint8Array} 1-bit values (0 = white, 1 = black)
   */
  _floydSteinbergDither(grayscale, width, height) {
    // Work on a copy to avoid modifying original
    const pixels = new Float32Array(grayscale);
    const output = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const oldPixel = pixels[idx];

        // Threshold to black (0) or white (255)
        const newPixel = oldPixel < 128 ? 0 : 255;
        output[idx] = newPixel === 0 ? 1 : 0; // 1 = black, 0 = white

        // Calculate quantization error
        const error = oldPixel - newPixel;

        // Distribute error to neighboring pixels (Floyd-Steinberg pattern)
        //       X   7/16
        // 3/16 5/16 1/16
        if (x + 1 < width) {
          pixels[idx + 1] += error * 7 / 16;
        }
        if (y + 1 < height) {
          if (x > 0) {
            pixels[(y + 1) * width + (x - 1)] += error * 3 / 16;
          }
          pixels[(y + 1) * width + x] += error * 5 / 16;
          if (x + 1 < width) {
            pixels[(y + 1) * width + (x + 1)] += error * 1 / 16;
          }
        }
      }
    }

    return output;
  }

  /**
   * Apply Atkinson dithering to grayscale image
   * Lighter result than Floyd-Steinberg, good for preserving detail
   * Only distributes 6/8 of error (loses some darkness)
   * @param {Float32Array} grayscale - Grayscale values 0-255
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {Uint8Array} 1-bit values (0 = white, 1 = black)
   */
  _atkinsonDither(grayscale, width, height) {
    const pixels = new Float32Array(grayscale);
    const output = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const oldPixel = pixels[idx];

        const newPixel = oldPixel < 128 ? 0 : 255;
        output[idx] = newPixel === 0 ? 1 : 0;

        // Atkinson only distributes 6/8 of the error (intentionally loses 2/8)
        const error = (oldPixel - newPixel) / 8;

        // Distribute error to 6 neighbors (1/8 each)
        //       X   1   1
        //   1   1   1
        //       1
        if (x + 1 < width) {
          pixels[idx + 1] += error;
        }
        if (x + 2 < width) {
          pixels[idx + 2] += error;
        }
        if (y + 1 < height) {
          if (x > 0) {
            pixels[(y + 1) * width + (x - 1)] += error;
          }
          pixels[(y + 1) * width + x] += error;
          if (x + 1 < width) {
            pixels[(y + 1) * width + (x + 1)] += error;
          }
        }
        if (y + 2 < height) {
          pixels[(y + 2) * width + x] += error;
        }
      }
    }

    return output;
  }

  /**
   * Apply ordered (Bayer) dithering to grayscale image
   * Creates regular pattern, good for graphics and when consistency matters
   * @param {Float32Array} grayscale - Grayscale values 0-255
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {Uint8Array} 1-bit values (0 = white, 1 = black)
   */
  _orderedDither(grayscale, width, height) {
    const output = new Uint8Array(width * height);

    // 8x8 Bayer matrix (normalized to 0-63, we scale to 0-255)
    const bayer8x8 = [
       0, 32,  8, 40,  2, 34, 10, 42,
      48, 16, 56, 24, 50, 18, 58, 26,
      12, 44,  4, 36, 14, 46,  6, 38,
      60, 28, 52, 20, 62, 30, 54, 22,
       3, 35, 11, 43,  1, 33,  9, 41,
      51, 19, 59, 27, 49, 17, 57, 25,
      15, 47,  7, 39, 13, 45,  5, 37,
      63, 31, 55, 23, 61, 29, 53, 21
    ];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const gray = grayscale[idx];

        // Get threshold from Bayer matrix (scale from 0-63 to 0-255)
        const bayerIdx = (y % 8) * 8 + (x % 8);
        const threshold = (bayer8x8[bayerIdx] / 64) * 255;

        // Compare pixel to threshold
        output[idx] = gray < threshold ? 1 : 0;
      }
    }

    return output;
  }


}
const algorithms = new RasterAlgorithms();

export function monochromePixels(pixels,width,height,mode='threshold',protectedRegions=[]) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||width>576||height<1||height>640 || pixels.length!==width*height*4 || !['threshold','floyd-steinberg','atkinson','ordered'].includes(mode))throw new PrinterError('invalid_image');
  const gray=algorithms._rgbaToGrayscale(pixels,width,height,mode==='threshold'?1:1.3);
  let dots;
  if(mode==='threshold')dots=Uint8Array.from(gray,value=>value<128?1:0);
  else if(mode==='atkinson')dots=algorithms._atkinsonDither(gray,width,height);
  else if(mode==='ordered')dots=algorithms._orderedDither(gray,width,height);
  else dots=algorithms._floydSteinbergDither(gray,width,height);
  // Preserve binary artwork exactly (upstream Bayer's zero threshold can erase black).
  for(let i=0;i<gray.length;i++)if(gray[i]===0 || gray[i]===255)dots[i]=gray[i]===0?1:0;
  // Keep QR modules/quiet zones binary even when image dithering is selected.
  for(const region of protectedRegions)for(let y=Math.max(0,Math.floor(region.y));y<Math.min(height,Math.ceil(region.y+region.height));y++) {
    for(let x=Math.max(0,Math.floor(region.x));x<Math.min(width,Math.ceil(region.x+region.width));x++)dots[y*width+x]=gray[y*width+x]<128?1:0;
  }
  return dots;
}
export function packRaster(dots,width,height) {
  if(dots.length!==width*height || !Number.isInteger(width)||width<1||width>576 || !Number.isInteger(height)||height<1||height>640)throw new PrinterError('invalid_image');
  const widthBytes=72,data=new Uint8Array(widthBytes*height),offset=576-width;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(dots[y*width+x]) {
    const bit=offset+x;data[y*widthBytes+(bit>>3)]|=1<<(7-(bit&7));
  }
  return {data,widthBytes,heightLines:height};
}
export function previewPixels(dots) {
  const rgba=new Uint8ClampedArray(dots.length*4);
  for(let i=0;i<dots.length;i++){const value=dots[i]?0:255;rgba.set([value,value,value,255],i*4);}
  return rgba;
}

