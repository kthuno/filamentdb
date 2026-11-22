import { initI18n, initLanguagePicker, translateDocument, t, th } from './i18n.js';
import { configureAppActions } from './actions.js';
import { initConsumption, renderUsageHistory, updateUsageFilterOptions } from './consumption.js';
import { $, esc, notify, request } from './core.js';
import { initDashboard, renderDashboard, renderUsageStatistics, updateUsageStatisticsYears } from './dashboard.js';
import { initFiles, loadFileArchive } from './files.js';
import { initInstall } from './install.js';
import { edit, handleSpoolLink, initInventory, populateMaterialTypes, renderInventory, resetSpoolLink } from './inventory.js';
import { fetchInventory, fetchUsage, inventoryState } from './inventory-data.js';
import { initKnowledge, showKnowledgeRoute } from './knowledge.js';
import { initLabels } from './labels.js';
import { initLocations, renderLocations } from './locations.js';
import { initPrints } from './prints.js';
import { initProjects, loadBuildPlates, loadProjects, offerCompletedProjectDeletion } from './projects.js';
// Application initialization, refresh coordination and hash navigation.
async function switchView() {
  const hash = window.location.hash;
  // Old bookmarks still lead to locations; Administration is no longer a view.
  if (hash === '#admin') { window.location.hash = '#locations'; return; }
  const pages = ['dashboard','archive','usage','projects','files','knowledge','locations','build-plates','qr-labels'];
  const selected = hash === '#files' || hash.startsWith('#files/') ? 'files' : hash === '#knowledge' || hash.startsWith('#knowledge/') ? 'knowledge' : pages.find(page => hash === '#'+page) || (hash.startsWith('#spool/') || hash === '#cards' ? 'archive' : 'dashboard');
  if (!hash.startsWith('#spool/')) resetSpoolLink();
  for (const page of pages) {
    const active = page === selected;
    $('#'+page+'-view').hidden = !active;
    $('#nav-'+page).classList.toggle('active', active);
    $('#nav-'+page).setAttribute('aria-current', active ? 'page' : 'false');
  }
  if (selected === 'locations' || selected === 'qr-labels') {
    try { await load(); }
    catch(error) { if (selected === 'locations') $('#location-error').textContent = error.message; else notify(t("ui.kunne_ikke_hente_spoler_til_labels_da376f")+error.message); }
  } else if (selected === 'build-plates') {
    try { await loadBuildPlates(); } catch(error) { $('#build-plate-error').textContent = error.message; }
  } else if (selected === 'knowledge') {
    await showKnowledgeRoute();
  } else if (selected === 'files') {
    await loadFileArchive();
  } else if (selected === 'projects') {
    await loadProjects();
  } else if (selected === 'dashboard' || selected === 'usage') {
    await loadUsage();
  } else if (selected === 'archive') {
    await handleSpoolLink();
  }
}

function render() {
  renderInventory();
  renderDashboard();
}
async function load() {
  await fetchInventory();
  populateMaterialTypes(inventoryState.materialTypes);
  const current = $('#material-filter').value;
  $('#material-filter').innerHTML = `<option value="">${th("ui.alle_materialer_4b987d")}</option>` + [...new Set(inventoryState.spools.map(spool => spool.material))].sort().map(material => `<option value="${esc(material)}">${esc(material)}</option>`).join('');
  $('#material-filter').value = current;
  renderLocations();
  render();
  await handleSpoolLink();
}
function renderUsage() {
  updateUsageStatisticsYears();
  renderUsageStatistics();
  updateUsageFilterOptions();
  renderUsageHistory();
}
async function loadUsage() {
  $('#usage-error').textContent = '';
  $('#dashboard-error').textContent = '';
  try {
    await fetchUsage();
    renderUsage();
  } catch (error) {
    $('#usage-error').textContent = error.message;
    $('#dashboard-error').textContent = error.message;
  }
}
let appInitialized = false;
function initApp() {
  if (appInitialized) return;
  appInitialized = true;
  configureAppActions({load: () => load(), loadUsage: () => loadUsage(),
    switchView: () => switchView(),
    edit: (...args) => edit(...args), loadProjects: () => loadProjects(),
    loadFileArchive: (...args) => loadFileArchive(...args),
    offerCompletedProjectDeletion: (...args) => offerCompletedProjectDeletion(...args)});
  translateDocument();
  initLanguagePicker();
  initProjects();
  initFiles();
  initKnowledge();
  initInstall();
  initInventory();
  initDashboard();
  initConsumption();
  initLabels();
  initPrints();
  initLocations();
  window.addEventListener('hashchange', switchView);
}
async function startApp() {
  await initI18n();
  initApp();
  // All feature scripts have loaded before route-specific work starts.
  await Promise.all([
    load().catch(error => notify(t("ui.kunne_ikke_hente_arkivet_7ad2b8")+error.message)),
    switchView(),
  ]);
  await request('/api/version').then(data => {
    $('#app-version').textContent = t("ui.filament_db_v_9d6f6e", {p0: data.version});
    $('#database-backend').textContent = {sqlite: 'SQLite', mysql: 'MySQL'}[data.database] || t("ui.database_fa7fe6");
  }).catch(() => {
    $('#app-version').textContent = t("ui.version_utilgaengelig_38bcad");
    $('#database-backend').textContent = t("ui.database_utilgaengelig_12cf8e");
  });
}

export { initApp, startApp, switchView };
