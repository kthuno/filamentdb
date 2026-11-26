/**
 * Printer protocol for Phomemo printers
 * Handles print commands for both USB and BLE transports
 * Supports M-series (M02, M110, M200, M220, M260) and D-series (D30, D110)
 *
 * Printer definitions are data-driven from printers.json + user custom definitions.
 */

import { STORAGE_KEYS } from './constants.js';

// =============================================================================
// PRINTER DEFINITIONS MANAGER
// =============================================================================

// All loaded printer definitions (built-in + custom, custom wins on id collision)
let _allDefinitions = [];
// Built-in definitions loaded from printers.json
let _builtinDefinitions = [];
// Whether definitions have been loaded
let _loaded = false;

/**
 * Load built-in printer definitions from printers.json
 * Should be called once at app startup
 */
export async function loadPrinterDefinitions() {
  try {
    const json = {
  "version": 1,
  "printers": [
    {
      "id": "p12",
      "name": "P12 / P12 Pro",
      "group": "Tape Printers",
      "description": "12mm continuous tape label maker",
      "protocol": "p12",
      "widthBytes": 12,
      "dpi": 203,
      "alignment": "center",
      "rotated": true,
      "tape": true,
      "tapeWidths": [12],
      "defaultTapeWidth": 12,
      "namePatterns": ["P12 PRO", "P12PRO", "P12"],
      "labelPresets": "tape",
      "builtin": true
    },
    {
      "id": "a30",
      "name": "A30",
      "group": "Tape Printers",
      "description": "12-15mm continuous tape, faster print speed",
      "protocol": "p12",
      "widthBytes": 15,
      "dpi": 203,
      "alignment": "center",
      "rotated": true,
      "tape": true,
      "tapeWidths": [12, 14, 15],
      "defaultTapeWidth": 15,
      "namePatterns": ["A30"],
      "labelPresets": "tape",
      "builtin": true
    },
    {
      "id": "m02",
      "name": "M02 / M02S / M02X",
      "group": "M02 Series",
      "description": "Mini pocket printers (48mm, continuous paper)",
      "protocol": "m02",
      "widthBytes": 48,
      "dpi": 203,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["M02X", "M02S", "M02"],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m02-pro",
      "name": "M02 Pro",
      "group": "M02 Series",
      "description": "300 DPI high-resolution mini printer (53mm)",
      "protocol": "m02",
      "widthBytes": 78,
      "dpi": 300,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["M02 PRO", "M02PRO"],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m03",
      "name": "M03",
      "group": "M03 Series",
      "description": "Mini sticker printer (53mm)",
      "protocol": "m-series",
      "widthBytes": 54,
      "dpi": 203,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["M03"],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "t02",
      "name": "T02",
      "group": "T02 Series",
      "description": "Mini sticker printer (48mm)",
      "protocol": "m-series",
      "widthBytes": 48,
      "dpi": 203,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["T02"],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m04s-53",
      "name": "M04S - 53mm paper",
      "group": "M04 Series",
      "description": "300 DPI multi-width printer set to 53mm",
      "protocol": "m04",
      "widthBytes": 75,
      "dpi": 300,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["M04A", "M04"],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m04s-80",
      "name": "M04S - 80mm paper",
      "group": "M04 Series",
      "description": "300 DPI multi-width printer set to 80mm",
      "protocol": "m04",
      "widthBytes": 112,
      "dpi": 300,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": [],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m04s-110",
      "name": "M04S - 110mm paper",
      "group": "M04 Series",
      "description": "300 DPI multi-width printer set to 110mm",
      "protocol": "m04",
      "widthBytes": 154,
      "dpi": 300,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": [],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m110",
      "name": "M110 / M120",
      "group": "M110 Series",
      "description": "Narrow label makers (48mm)",
      "protocol": "m110",
      "widthBytes": 48,
      "dpi": 203,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["M110", "M120"],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m110s",
      "name": "M110S",
      "group": "M110 Series",
      "description": "Narrow label maker, right-aligned roll (48mm)",
      "protocol": "m110",
      "widthBytes": 48,
      "dpi": 203,
      "alignment": "right",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": [],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m200",
      "name": "M200",
      "group": "M200 Series",
      "description": "Mid-size label maker (75mm)",
      "protocol": "m-series",
      "widthBytes": 76,
      "dpi": 203,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["M200"],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m250",
      "name": "M250",
      "group": "M200 Series",
      "description": "Mid-size label maker (75mm label, 72-byte width)",
      "protocol": "m-series",
      "widthBytes": 72,
      "dpi": 203,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["M250"],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m220",
      "name": "M220",
      "group": "M200 Series",
      "description": "Wide label maker, right-aligned roll (75mm)",
      "protocol": "m-series",
      "widthBytes": 72,
      "dpi": 203,
      "alignment": "right",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["M220"],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m221",
      "name": "M221",
      "group": "M200 Series",
      "description": "Wide label maker, centered roll (75mm)",
      "protocol": "m-series",
      "widthBytes": 72,
      "dpi": 203,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["M221"],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "m260",
      "name": "M260",
      "group": "M200 Series",
      "description": "Wide label maker (72mm)",
      "protocol": "m-series",
      "widthBytes": 72,
      "dpi": 203,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["M260"],
      "labelPresets": "m-series",
      "builtin": true
    },
    {
      "id": "pm241",
      "name": "PM-241-BT",
      "group": "PM-241 Series",
      "description": "4-inch shipping label printer (102mm, USB)",
      "protocol": "tspl",
      "widthBytes": 102,
      "dpi": 203,
      "alignment": "center",
      "rotated": false,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["PM-241", "PM241", "PM 241"],
      "labelPresets": "pm241",
      "builtin": true
    },
    {
      "id": "d-series",
      "name": "D30 / D35 / D50 / Q30 / Q30S",
      "group": "D-Series",
      "description": "Smart mini label makers (rotated protocol)",
      "protocol": "d-series",
      "widthBytes": null,
      "dpi": 203,
      "alignment": "center",
      "rotated": true,
      "tape": false,
      "tapeWidths": null,
      "defaultTapeWidth": null,
      "namePatterns": ["D30", "D35", "D50", "Q30S", "Q30", "D"],
      "labelPresets": "d-series",
      "builtin": true
    }
  ]
}
;
    _builtinDefinitions = json.printers || [];
  } catch (e) {
    console.error('Failed to load printers.json:', e);
    _builtinDefinitions = [];
  }
  _loaded = true;
  _rebuildDefinitions();
}

/**
 * Get all printer definitions (built-in + custom, merged)
 * Custom definitions with the same id override built-in ones.
 * @returns {Array} All printer definitions
 */
export function getAllPrinterDefinitions() {
  if (!_loaded) {
    console.warn('Printer definitions not loaded yet; returning empty list');
    return [];
  }
  return _allDefinitions;
}

/**
 * Get a single printer definition by id
 * @param {string} id - Printer definition id
 * @returns {Object|null}
 */
export function getPrinterDefinition(id) {
  return _allDefinitions.find(d => d.id === id) || null;
}

/**
 * Get all custom (user-created/overridden) printer definitions from localStorage
 * @returns {Array}
 */
export function getCustomPrinterDefinitions() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CUSTOM_PRINTERS);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load custom printers:', e);
    return [];
  }
}

/**
 * Save a custom printer definition (create or update)
 * @param {Object} def - Printer definition object
 */
export function saveCustomPrinterDefinition(def) {
  const customs = getCustomPrinterDefinitions();
  const idx = customs.findIndex(d => d.id === def.id);
  const saved = { ...def, builtin: false };
  if (idx >= 0) {
    customs[idx] = saved;
  } else {
    customs.push(saved);
  }
  localStorage.setItem(STORAGE_KEYS.CUSTOM_PRINTERS, JSON.stringify(customs));
  _rebuildDefinitions();
}

/**
 * Delete a custom printer definition
 * @param {string} id - Printer definition id to delete
 */
export function deleteCustomPrinterDefinition(id) {
  const customs = getCustomPrinterDefinitions().filter(d => d.id !== id);
  localStorage.setItem(STORAGE_KEYS.CUSTOM_PRINTERS, JSON.stringify(customs));
  _rebuildDefinitions();
}

/**
 * Check if a printer definition id is a built-in
 * @param {string} id
 * @returns {boolean}
 */
export function isBuiltinPrinter(id) {
  return _builtinDefinitions.some(d => d.id === id);
}

/**
 * Reset a customized built-in printer back to its original definition
 * @param {string} id
 */
export function resetBuiltinPrinter(id) {
  deleteCustomPrinterDefinition(id);
}

/**
 * Get the available protocol types (for the editor UI)
 */
export function getAvailableProtocols() {
  return [
    { value: 'm-series', label: 'M-series (ESC/POS Raster)' },
    { value: 'm02', label: 'M02-series (ESC/POS with Prefix)' },
    { value: 'm04', label: 'M04-series (300 DPI)' },
    { value: 'm110', label: 'M110-series (phomemo-tools)' },
    { value: 'd-series', label: 'D-series (Rotated)' },
    { value: 'p12', label: 'P12/Tape (Rotated, Continuous)' },
    { value: 'tspl', label: 'TSPL (Shipping Label)' },
  ];
}

/**
 * Get the available label preset groups (for the editor UI)
 */
export function getAvailableLabelPresets() {
  return [
    { value: 'm-series', label: 'M-series (standard labels)' },
    { value: 'd-series', label: 'D-series (small labels)' },
    { value: 'tape', label: 'Tape (continuous tape)' },
    { value: 'pm241', label: 'PM-241 (shipping labels)' },
  ];
}

/**
 * Rebuild the merged definitions list from built-in + custom
 */
function _rebuildDefinitions() {
  const customs = getCustomPrinterDefinitions();
  const customIds = new Set(customs.map(d => d.id));

  // Start with built-ins that haven't been overridden
  _allDefinitions = _builtinDefinitions
    .filter(d => !customIds.has(d.id))
    .map(d => ({ ...d }));

  // Add all custom definitions
  for (const c of customs) {
    _allDefinitions.push({ ...c });
  }
}

// =============================================================================
// DETECTION AND CONFIG (data-driven from definitions)
// =============================================================================

// Default configuration when no definition matches
const DEFAULT_CONFIG = { width: 72, protocol: 'm-series', dpi: 203 };

/**
 * Build a flat name-pattern list from all definitions for auto-detection.
 * More specific (longer) patterns come first to avoid false matches.
 * Custom definitions' patterns come before built-in ones.
 */
function _buildPatternList() {
  const customs = _allDefinitions.filter(d => !d.builtin);
  const builtins = _allDefinitions.filter(d => d.builtin);

  const list = [];
  for (const def of [...customs, ...builtins]) {
    if (!def.namePatterns) continue;
    for (const pat of def.namePatterns) {
      list.push({ pattern: pat.toUpperCase(), def });
    }
  }
  // Sort longer patterns first for specificity
  list.sort((a, b) => b.pattern.length - a.pattern.length);
  return list;
}

/**
 * Get printer configuration from device name (auto-detect)
 * @param {string} deviceName - BLE device name
 * @returns {Object} { width, protocol, dpi, recognized, matchedPattern, definition }
 */
function detectPrinterConfig(deviceName) {
  if (!deviceName) return { ...DEFAULT_CONFIG, recognized: false, matchedPattern: null, definition: null };

  const name = deviceName.toUpperCase();
  const patterns = _buildPatternList();

  for (const { pattern, def } of patterns) {
    if (name.startsWith(pattern)) {
      return {
        width: def.widthBytes,
        protocol: def.protocol,
        dpi: def.dpi || 203,
        recognized: true,
        matchedPattern: pattern,
        definition: def,
      };
    }
  }
  return { ...DEFAULT_CONFIG, recognized: false, matchedPattern: null, definition: null };
}

/**
 * Get printer configuration from manual model override
 * @param {string} modelOverride - Manual model selection (printer definition id)
 * @returns {Object|null}
 */
function getOverrideConfig(modelOverride) {
  if (!modelOverride || modelOverride === 'auto') return null;

  const def = getPrinterDefinition(modelOverride);
  if (def) {
    return {
      width: def.widthBytes,
      protocol: def.protocol,
      dpi: def.dpi || 203,
      definition: def,
    };
  }
  return null;
}

/**
 * Convert density level (1-8) to heat time value
 * Higher heat time = darker print
 */
function densityToHeatTime(density) {
  // Map density 1-8 to heat time values
  // Range approximately 40-200 (40=very light, 200=very dark)
  const heatTimes = [40, 60, 80, 100, 120, 140, 160, 200];
  return heatTimes[Math.max(0, Math.min(7, density - 1))];
}

function _resolveConfig(deviceName, modelOverride = 'auto') {
  const overrideConfig = getOverrideConfig(modelOverride);
  if (overrideConfig) return overrideConfig;
  return detectPrinterConfig(deviceName);
}

/**
 * Check if a device name is recognized (matches a known pattern)
 */
export function isDeviceRecognized(deviceName) {
  return detectPrinterConfig(deviceName).recognized;
}

/**
 * Get the matched pattern for a device name
 */
export function getMatchedPattern(deviceName) {
  return detectPrinterConfig(deviceName).matchedPattern;
}

/**
 * Get the definition that matched a device name (for auto-detect)
 */
export function getDetectedDefinition(deviceName) {
  return detectPrinterConfig(deviceName).definition;
}

export function isDSeriesPrinter(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'd-series';
}

export function isM02Printer(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'm02';
}

export function isP12Printer(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'p12';
}

export function isA30Printer(deviceName, modelOverride = 'auto') {
  const def = _resolveConfig(deviceName, modelOverride).definition;
  return def?.id === 'a30';
}

export function isTapePrinter(deviceName, modelOverride = 'auto') {
  const config = _resolveConfig(deviceName, modelOverride);
  const def = config.definition;
  if (def) return !!def.tape;
  return config.protocol === 'p12';
}

export function isPM241Printer(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'tspl';
}

export function isTSPLPrinter(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'tspl';
}

function isM110Printer(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'm110';
}

function isM04Printer(deviceName, modelOverride = 'auto') {
  return _resolveConfig(deviceName, modelOverride).protocol === 'm04';
}

export function isRotatedPrinter(deviceName, modelOverride = 'auto') {
  const config = _resolveConfig(deviceName, modelOverride);
  const def = config.definition;
  if (def) return !!def.rotated;
  // Fallback: D-series and P12 protocols are rotated
  return config.protocol === 'd-series' || config.protocol === 'p12';
}

export function isNarrowMSeriesPrinter(deviceName, modelOverride = 'auto') {
  return getPrinterWidthBytes(deviceName, modelOverride) === 48;
}

export function getPrinterAlignment(deviceName, modelOverride = 'auto') {
  const config = _resolveConfig(deviceName, modelOverride);
  const def = config.definition;
  if (def && def.alignment) return def.alignment;
  return 'center';
}

export function getPrinterWidthBytes(deviceName, modelOverride = 'auto') {
  const overrideConfig = getOverrideConfig(modelOverride);
  if (overrideConfig && overrideConfig.width !== null) return overrideConfig.width;
  const config = detectPrinterConfig(deviceName);
  return config.width ?? DEFAULT_CONFIG.width;
}

export function getPrinterDpi(deviceName, modelOverride = 'auto') {
  const config = _resolveConfig(deviceName, modelOverride);
  return config.dpi || 203;
}

export function getPrinterDescription(deviceName, modelOverride = 'auto') {
  const config = _resolveConfig(deviceName, modelOverride);
  const def = config.definition;
  if (def) {
    const widthMm = def.widthBytes ? Math.round(def.widthBytes * 8 / 8) : null;
    return def.name + (widthMm ? ` (${widthMm}mm)` : '');
  }
  // Fallback for unrecognized printers
  const width = getPrinterWidthBytes(deviceName, modelOverride);
  const widthMm = Math.round(width * 8 / 8);
  return `M-series (${widthMm}mm)`;
}

// Hardware commands are intentionally excluded from the embedded designer.
export async function print() {throw new Error('Printing belongs to Filament DB');}
export async function printDensityTest() {throw new Error('Printing belongs to Filament DB');}
