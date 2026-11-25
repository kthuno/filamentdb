import { initAdministration, loadMaterialTypeAdmin, loadVersionInfo, loadDatabaseStatus, openAdministrationSection } from './administration.js';
import { initI18n, initLanguagePicker, translateDocument, t, th } from './i18n.js';
import { configureAppActions } from './actions.js';
import { initConsumption, renderUsageHistory, updateUsageFilterOptions } from './consumption.js';
import { $, esc, notify, request } from './core.js';
import { initDashboard, renderDashboard, renderUsageStatistics, updateUsageStatisticsYears } from './dashboard.js';
import { initFiles, loadFileArchive } from './files.js';
import { edit, handleSpoolLink, initInventory, populateMaterialTypes, renderInventory, resetSpoolLink } from './inventory.js';
import { fetchInventory, fetchUsage, inventoryState } from './inventory-data.js';
import { initKnowledge, loadKnowledgeCategories, showKnowledgeRoute } from './knowledge.js';
import { initLabels, refreshLabels } from './labels.js';
import { initLocations, renderLocations } from './locations.js';
import { initPrints } from './prints.js';
import { initProjects, loadBuildPlates, loadProjects, offerCompletedProjectDeletion } from './projects.js';
// Application initialization, refresh coordination and hash navigation.
async function switchView() {
  let hash = window.location.hash;
  if(hash==='#build-plates') {
    hash='#admin/build-plates';
    if(window.history?.replaceState)window.history.replaceState(null,'',hash);
    else window.location.hash=hash;
  }
  const pages = ['dashboard','archive','usage','projects','files','knowledge','locations','qr-labels','admin'];
  const selected = hash === '#admin' || hash.startsWith('#admin/') ? 'admin' : hash === '#files' || hash.startsWith('#files/') ? 'files' : hash === '#knowledge' || hash.startsWith('#knowledge/') ? 'knowledge' : pages.find(page => hash === '#'+page) || (hash.startsWith('#spool/') || hash === '#cards' ? 'archive' : 'dashboard');
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
  } else if (selected === 'admin') {
    $('#build-plate-error').textContent='';
    $('#knowledge-category-error').textContent='';
    $('#material-type-error').textContent='';
    await Promise.all([
      loadDatabaseStatus(),
      loadMaterialTypeAdmin().catch(error=>{ $('#material-type-error').textContent=error.message; }),
      loadBuildPlates().catch(error=>{ $('#build-plate-error').textContent=error.message; }),
      loadKnowledgeCategories().catch(error=>{ $('#knowledge-category-error').textContent=error.message; }),
    ]);
    if(window.location.hash===hash)openAdministrationSection(hash);
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
  await refreshLabels();
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
  initAdministration({onMaterialsChanged:()=>load()});
  initProjects();
  initFiles();
  initKnowledge();
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
  await loadVersionInfo();
}

export { initApp, startApp, switchView };
