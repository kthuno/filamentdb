// Adapted from Phomymo by transcriptionstream and contributors (MIT, as confirmed by the project owner).
// Upstream: 1f58d3f0e7f941b9143277cda828380149e56855, src/web/printer.js.
// See vendor/phomymo-NOTICE.txt for origin, license evidence, and modifications.
function densityToHeatTime(density) {
  // Map density 1-8 to heat time values
  // Range approximately 40-200 (40=very light, 200=very dark)
  const heatTimes = [40, 60, 80, 100, 120, 140, 160, 200];
  return heatTimes[Math.max(0, Math.min(7, density - 1))];
}

// ESC/POS commands for M-series
const CMD = {
  INIT: new Uint8Array([0x1b, 0x40]),
  FEED: (dots) => new Uint8Array([0x1b, 0x4a, dots]),
  // Standard ESC/POS density (GS | n) - may not work on all printers
  DENSITY: (level) => new Uint8Array([0x1d, 0x7c, level]),
  // ESC 7 - Heat settings (n1=max dots, n2=heat time, n3=heat interval)
  // Heat time (n2): higher = darker, range ~3-255, default ~80
  // This command is common on Chinese thermal printers
  HEAT_SETTINGS: (maxDots, heatTime, heatInterval) =>
    new Uint8Array([0x1b, 0x37, maxDots, heatTime, heatInterval]),
  LINE_SPACING: (dots) => new Uint8Array([0x1b, 0x33, dots]),
  RASTER_HEADER: (widthBytes, heightLines) => new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes, 0x00,
    heightLines & 0xff, (heightLines >> 8) & 0xff,
  ]),
};

export async function printBLE(transport, data, widthBytes, heightLines, density, feed, onProgress) {
  // Init - must be right before data
  await transport.send(CMD.INIT);
  await transport.delay(100);

  // Set density using ESC 7 heat command (more widely supported)
  const heatTime = densityToHeatTime(density);
  await transport.send(CMD.HEAT_SETTINGS(7, heatTime, 2));
  await transport.delay(30);
  // Also send standard density command as backup
  await transport.send(CMD.DENSITY(density));
  await transport.delay(50);

  // Raster header
  await transport.send(CMD.RASTER_HEADER(widthBytes, heightLines));

  // Send data in 128-byte chunks
  const chunkSize = 128;

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
    await transport.send(chunk);
    await transport.delay(20);

    if (onProgress) {
      const progress = Math.round((i + chunk.length) / data.length * 100);
      onProgress(progress);
    }
  }

  // Feed after print
  await transport.delay(300);
  await transport.send(CMD.FEED(feed));
  await transport.delay(800);

}


export async function printUSB(transport, data, widthBytes, heightLines, density, feed, onProgress) {
  // Init
  await transport.send(CMD.INIT);
  await transport.delay(100);

  // Density and line spacing
  await transport.send(CMD.DENSITY(density));
  await transport.send(CMD.LINE_SPACING(0)); // Line spacing 0

  // Initial feed
  await transport.send(CMD.FEED(0x0c)); // 12 dots
  await transport.delay(50);

  // Raster header
  await transport.send(CMD.RASTER_HEADER(widthBytes, heightLines));

  // Send data in 512-byte chunks
  const chunkSize = 512;

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
    await transport.send(chunk);
    await transport.delay(20);

    if (onProgress) {
      const progress = Math.round((i + chunk.length) / data.length * 100);
      onProgress(progress);
    }
  }

  // Final feed
  await transport.delay(100);
  await transport.send(CMD.FEED(feed));

}



