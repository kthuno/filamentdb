import { compareLocationNames, request } from './core.js';
// Shared data snapshots. Fetching does not read or render DOM elements.
const inventorySnapshot = {spools: Object.freeze([]), locations: Object.freeze([]), materialTypes: Object.freeze([]), loaded: false};
const inventoryState = Object.freeze({
  get spools() { return inventorySnapshot.spools; },
  get locations() { return inventorySnapshot.locations; },
  get materialTypes() { return inventorySnapshot.materialTypes; },
  get loaded() { return inventorySnapshot.loaded; },
});
const usageSnapshot = {entries: Object.freeze([])};
const usageState = Object.freeze({get entries() { return usageSnapshot.entries; }});
function freezeSnapshot(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}
async function fetchInventory() {
  const [spools, locations, materialTypes] = await Promise.all([
    request('/api/filaments'), request('/api/locations'), request('/api/material-types'),
  ]);
  inventorySnapshot.spools = freezeSnapshot(spools);
  inventorySnapshot.locations = freezeSnapshot(locations.sort((a,b) => compareLocationNames(a.name,b.name)));
  inventorySnapshot.materialTypes = freezeSnapshot(materialTypes);
  inventorySnapshot.loaded = true;
}
async function fetchUsage() {
  const entries = await request('/api/consumption');
  usageSnapshot.entries = freezeSnapshot(entries);
}

export { fetchInventory, fetchUsage, inventoryState, usageState };
