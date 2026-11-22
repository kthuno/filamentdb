import { t, th } from './i18n.js';
import { load, loadProjects, loadUsage, offerCompletedProjectDeletion } from './actions.js';
import { $, esc, notify, number, productLink, request } from './core.js';
import { inventoryState } from './inventory-data.js';
// Print and waste share one draft owner. Other features use PrintEditor.
const printDraft = {items: [], wasteId: null, wasteMode: false, projectId: null, printId: null,
  originalItems: [], image: '', imageVersion: 0, imageLoading: false};
function printDurationInput() {
  const hours = $('#print-hours').value, minutes = $('#print-minutes').value;
  return hours === '' && minutes === '' ? null : Number(hours || 0)*60+Number(minutes || 0);
}

function printCandidates(records, items, query) {
  return records.filter(s => s.remaining > 0 && !items.some(item => item.filament_id === s.id) && [s.id,s.name,s.material,s.color,s.active_slot,s.product_id].join(' ').toLocaleLowerCase('da').includes(query.toLocaleLowerCase('da'))).sort((a,b) => Number(Boolean(b.active_slot))-Number(Boolean(a.active_slot)) || b.id-a.id);
}
function renderPrintCandidates() {
  const candidates = printCandidates(inventoryState.spools.map(s => ({...s, remaining:printAvailable(s)})), printDraft.items, $('#print-search').value);
  $('#print-spool').innerHTML = candidates.map(s => `<option value="${s.id}">${th("ui.g_cf85c0", {p1: esc(s.active_slot ? s.active_slot + ' · ' : ''), p2: esc(s.name), p3: esc(s.material), p4: esc(s.color || ''), p5: number(s.remaining)})}</option>`).join('') || `<option value="">${th("ui.ingen_spoler_matcher_8d4dc9")}</option>`;
  $('#print-add').disabled = !candidates.length;
}
function updatePrintTotal() { $('#print-total').textContent = t("ui.samlet_forbrug_g_6ff78f", {p0: number(printDraft.items.reduce((sum,item) => sum + (Number(item.grams) || 0),0))}); }
function renderPrintItems() {
  $('#print-items').innerHTML = printDraft.items.map(item => {
    const spool = inventoryState.spools.find(spool => spool.id === item.filament_id);
    const title = spool ? spool.name : item.label || t("ui.vaelg_spole_til_projektet_fc4bf0");
    const candidates = inventoryState.spools.filter(candidate => candidate.id === item.filament_id || (printAvailable(candidate) > 0 && !printDraft.items.some(line => line.filament_id === candidate.id)));
    return `<div class="print-item"><div class="print-item-heading"><strong>${esc(title)}</strong><small>${spool ? th("ui.g_til_raadighed_1f1791", {p0: esc(spool.material), p1: esc(spool.color || ''), p2: number(printAvailable(spool))}) : th("ui.estimat_fra_projektet_vaelg_en_konkret_spole_d7cbf3")}</small></div><label class="print-item-spool">${th("ui.spole_dd0993")}<select required data-print-spool="${item.filament_id}" aria-label="${th("ui.vaelg_spole_for_d9a6c5", {p3: esc(title)})}">${!spool ? `<option value="" selected>${th("ui.vaelg_spole_a10fcd")}</option>` : ''}${candidates.map(candidate => `<option value="${candidate.id}" ${candidate.id === item.filament_id ? 'selected' : ''}>${th("ui.g_ef32f5", {p2: candidate.id, p3: esc(candidate.name), p4: esc(candidate.material), p5: esc(candidate.color || ''), p6: number(printAvailable(candidate))})}</option>`).join('')}</select></label><label class="print-item-grams">${th("ui.forbrug_g_da84fc")}<input type="number" required min="0.01" step="0.01" ${spool ? `max="${printAvailable(spool)}"` : ''} value="${esc(item.grams)}" data-print-grams="${item.filament_id}"></label><button type="button" class="print-item-remove" data-print-remove="${item.filament_id}" aria-label="${th("ui.fjern_5f29cc", {p10: esc(title)})}">×</button></div>`;
  }).join('');
  updatePrintTotal(); renderPrintCandidates();
}

function printAvailable(spool) { return spool.remaining + (printDraft.originalItems.find(item => item.filament_id === spool.id)?.grams || 0); }

function clearPrintImage() {
  printDraft.imageVersion++; printDraft.imageLoading = false; printDraft.image = '';
  $('#print-image').value = ''; $('#print-image-preview').removeAttribute('src');
  $('#print-image-preview').hidden = true; $('#print-image-remove').hidden = true;
}
async function selectPrintImage(file) {
  if (printDraft.wasteMode || $('#print-archive-file').value) return;
  if (!file) return;
  const version = ++printDraft.imageVersion;
  printDraft.imageLoading = true; $('#print-error').textContent = '';
  const url = URL.createObjectURL(file);
  try {
    if (!file.type.startsWith('image/') || file.size > 20000000) throw new Error(t("ui.vaelg_et_billede_paa_hoejst_20_mb_96a3fc"));
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.8);
    if (data.length > 700000) throw new Error(t("ui.billedet_er_for_detaljeret_vaelg_et_mindre_bille_2a5692"));
    if (version !== printDraft.imageVersion) return;
    printDraft.image = data; $('#print-image-preview').src = data;
    $('#print-image-preview').hidden = false; $('#print-image-remove').hidden = false;
  } catch(error) {
    if (version === printDraft.imageVersion) $('#print-error').textContent = error.message || t("ui.billedet_kunne_ikke_aabnes_f3526c");
  } finally { URL.revokeObjectURL(url); if (version === printDraft.imageVersion) printDraft.imageLoading = false; }
}
function updatePrintProjectLink() {
  const link = productLink($('#print-project-url').value.trim());
  const anchor = $('#print-project-open');
  anchor.hidden = !link;
  if (link) anchor.setAttribute('href', link);
  else anchor.removeAttribute('href');
}
function setWasteMode(enabled) {
  $('#print-knowledge-panel').hidden = true;
  ++archiveImageVersion;
  $('#print-archive-images').hidden = true;
  $('#print-archive-gallery').innerHTML = '';
  printDraft.wasteMode = enabled; printDraft.projectId = null; $('#planned-print-hints').hidden = true;
  for (const selector of ['#print-name-field','#print-status-field','#print-link-field','#print-image-field','#print-duration-field','#print-archive-field']) $(selector).hidden = enabled;
  $('#print-name').required = !enabled;
  $('#print-archive-file').disabled = enabled;
  $('#print-project-url').disabled = enabled; $('#print-hours').disabled = enabled; $('#print-minutes').disabled = enabled;
  $('#waste-reason-field').hidden = !enabled;
  $('#waste-project-field').hidden = !enabled;
}
async function openWasteEditor(id = null) {
  await load();
  const [projects, waste] = await Promise.all([request('/api/prints'), id === null ? Promise.resolve(null) : request(`/api/waste/${id}`)]);
  setWasteMode(true); printDraft.wasteId = id; printDraft.printId = null;
  clearPrintImage(); $('#print-form').reset(); $('#print-error').textContent = '';
  printDraft.originalItems = waste ? waste.items.map(item => ({...item})) : [];
  printDraft.items = printDraft.originalItems.map(item => ({...item}));
  $('#print-dialog h2').textContent = waste ? t("ui.rediger_spild_89ed48") : t("ui.registrer_spild_4b89dc");
  $('#print-save').textContent = waste ? t("ui.gem_aendringer_04d6e9") : t("ui.gem_spild_05adb5");
  $('#print-repeat').hidden = true;
  const now = new Date();
  $('#print-date').value = waste ? waste.waste_date : `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  $('#print-note').value = waste?.note || '';
  $('#waste-reason').value = waste?.reason || 'other';
  $('#waste-project').innerHTML = `<option value="">${th("ui.ingen_tilknytning_d45a55")}</option>` + projects.map(project => `<option value="${project.id}">${esc(project.name)} · ${esc(project.print_date)}</option>`).join('');
  $('#waste-project').value = waste?.project_id == null ? '' : String(waste.project_id);
  renderPrintItems(); if (!$('#print-dialog').open) $('#print-dialog').showModal(); $('#waste-reason').focus();
}
async function openPrintEditor(id = null, repeat = false) {
  await load();
  const printing = id === null ? null : await request(`/api/prints/${id}`);
  setWasteMode(false); printDraft.wasteId = null;
  printDraft.printId = repeat ? null : id;
  printDraft.originalItems = printing && !repeat ? printing.items.map(item => ({...item})) : [];
  printDraft.items = printing ? printing.items.map(item => ({...item})) : [];
  clearPrintImage(); $('#print-form').reset(); $('#print-error').textContent = '';
  const archiveFiles = await request('/api/files');
  $('#print-archive-file').innerHTML = `<option value="">${th("ui.ingen_tilknyttet_fil_55c808")}</option>` + archiveFiles.map(file => `<option value="${file.id}">${esc(file.name)} · ${esc(file.filename)}</option>`).join('');
  $('#print-archive-file').value = printing?.archive_file_id == null ? '' : String(printing.archive_file_id);
  $('#print-dialog h2').textContent = repeat ? t("ui.print_igen_2214cd") : printing ? t("ui.rediger_print_33f8b7") : t("ui.registrer_print_3f1950");
  $('#print-repeat').hidden = printDraft.printId === null;
  $('#print-knowledge-panel').hidden = !printing || repeat || !['completed','failed'].includes(printing.status);
  $('#print-knowledge-generate').dataset.printId = printDraft.printId || '';
  $('#print-knowledge-generate').dataset.note = printing?.note || '';
  $('#print-knowledge-generate').dataset.name = printing?.name || '';
  $('#print-knowledge-generate').dataset.status = printing?.status || '';
  $('#print-save').textContent = printDraft.printId !== null ? t("ui.gem_aendringer_04d6e9") : t("ui.gem_print_ec9ab7");
  const now = new Date();
  const duration = printing?.duration_minutes;
  $('#print-hours').value = duration == null ? '' : String(Math.floor(duration/60));
  $('#print-minutes').value = duration == null ? '' : String(duration%60);
  $('#print-status').value = printing && !repeat ? (printing.status || 'completed') : 'completed';
  $('#print-date').value = printing && !repeat ? printing.print_date : `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  if (printing) {
    $('#print-name').value = printing.name; $('#print-note').value = printing.note; $('#print-project-url').value = printing.project_url || '';
    printDraft.image = printing.image;
    if (printDraft.image) { $('#print-image-preview').src = printDraft.image; $('#print-image-preview').hidden = false; $('#print-image-remove').hidden = false; }
  }
  if (repeat) $('#print-error').textContent = t("ui.ny_registrering_kontroller_dato_spoler_og_gramfo_af47a7");
  updatePrintProjectLink();
  renderPrintItems(); if (!$('#print-dialog').open) $('#print-dialog').showModal(); $('#print-name').focus();
  await renderPrintArchiveImages();
}

let archiveImageVersion = 0;
async function renderPrintArchiveImages() {
  const version = ++archiveImageVersion;
  const source = $('#print-archive-file').value;
  const linked = !printDraft.wasteMode && Boolean(source);
  $('#print-image-field').hidden = printDraft.wasteMode || linked;
  $('#print-image').disabled = printDraft.wasteMode || linked;
  $('#print-archive-images').hidden = !linked;
  $('#print-archive-gallery').innerHTML = '';
  $('#print-archive-images-status').textContent = '';
  if (!linked) return;
  // Discard an upload still being processed when the user chooses a file.
  ++printDraft.imageVersion;
  printDraft.imageLoading = false;
  $('#print-archive-images-status').textContent = t("ui.henter_billeder_fra_3mf_filen_0c0632");
  try {
    const file = await request(`/api/files/${Number(source)}/preview`);
    if (version !== archiveImageVersion || source !== $('#print-archive-file').value) return;
    const plates = file.plates.filter(plate => /^data:image\/(png|jpeg);base64,/.test(plate.thumbnail || ''));
    $('#print-archive-gallery').innerHTML = plates.map(plate => `<figure><img src="${esc(plate.thumbnail)}" alt="${th("ui.billede_fra_5f827a", {p1: esc(plate.name)})}"><figcaption>${esc(plate.name)}</figcaption></figure>`).join('');
    $('#print-archive-images-status').textContent = plates.length ? t("ui.billeder_fra_den_tilknyttede_originalfil_060aa4") : t("ui.den_tilknyttede_3mf_fil_har_ingen_billeder_8684be");
  } catch(error) {
    if (version === archiveImageVersion) $('#print-archive-images-status').textContent = t("ui.billederne_fra_filen_kunne_ikke_hentes_952188")+error.message;
  }
}

function initPrints() {
  $('#print-archive-file').onchange = renderPrintArchiveImages;
  $('#print-image').onchange = event => selectPrintImage(event.target.files[0]);
  $('#print-image-remove').onclick = clearPrintImage;
  $('#print-dialog').addEventListener('paste', event => {
    if (printDraft.wasteMode || $('#print-archive-file').value) return;
    const item = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
    if (item) { event.preventDefault(); selectPrintImage(item.getAsFile()); }
  });
  $('#print-project-url').oninput = updatePrintProjectLink;
  $('#new-waste').onclick = async () => {
    $('#new-waste').disabled = true;
    try { await openWasteEditor(); } catch(error) { $('#usage-error').textContent = error.message; }
    finally { $('#new-waste').disabled = false; }
  };
  $('#print-repeat').onclick = async () => {
    if (printDraft.printId === null) return;
    const button = $('#print-repeat'); button.disabled = true;
    try { await openPrintEditor(printDraft.printId, true); }
    catch(error) { $('#print-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  $('#new-print').onclick = async () => {
    const button = $('#new-print'); button.disabled = true;
    try { await openPrintEditor(); }
    catch(error) { $('#usage-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  $('#print-search').oninput = renderPrintCandidates;
  $('#print-add').onclick = () => { const id = Number($('#print-spool').value); if (!inventoryState.spools.some(s => s.id === id) || printDraft.items.some(item => item.filament_id === id)) return; const pending = printDraft.items.find(item => item.filament_id < 0); if (pending) pending.filament_id = id; else printDraft.items.push({filament_id:id,grams:''}); renderPrintItems(); };
  $('#print-items').oninput = event => { const id = Number(event.target.dataset.printGrams); const item = printDraft.items.find(item => item.filament_id === id); if(item) { item.grams = event.target.value; updatePrintTotal(); } };
  $('#print-items').onchange = event => {
    const id = Number(event.target.dataset.printSpool);
    if (!id) return;
    const replacement = Number(event.target.value);
    const item = printDraft.items.find(line => line.filament_id === id);
    if (!item || !inventoryState.spools.some(spool => spool.id === replacement) || printDraft.items.some(line => line.filament_id === replacement)) return;
    item.filament_id = replacement;
    renderPrintItems();
  };
  $('#print-items').onclick = event => { const button = event.target.closest('[data-print-remove]'); if(button) { printDraft.items = printDraft.items.filter(item => item.filament_id !== Number(button.dataset.printRemove)); renderPrintItems(); } };
  $('#print-close').onclick = $('#print-cancel').onclick = () => $('#print-dialog').close();
  $('#print-form').onsubmit = async event => {
    event.preventDefault(); $('#print-error').textContent = '';
    if (printDraft.imageLoading) { $('#print-error').textContent = t("ui.vent_mens_billedet_behandles_3e22f8"); return; }
    if (printDraft.items.some(item => !inventoryState.spools.some(spool => spool.id === item.filament_id))) { $('#print-error').textContent = t("ui.vaelg_en_konkret_spole_til_hver_forbrugslinje_a240c2"); return; }
    if(!printDraft.items.length) { $('#print-error').textContent = t("ui.tilfoej_mindst_en_spole_9ab81d"); return; }
    $('#print-save').disabled = true;
    try {
      const items = printDraft.items.map(item => ({filament_id:item.filament_id,grams:Number(item.grams)}));
      if (printDraft.wasteMode) {
        await request(printDraft.wasteId === null ? '/api/waste' : `/api/waste/${printDraft.wasteId}`, {method:printDraft.wasteId === null ? 'POST' : 'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({waste_date:$('#print-date').value,reason:$('#waste-reason').value,note:$('#print-note').value,project_id:$('#waste-project').value ? Number($('#waste-project').value) : null,items})});
      } else {
      await request(printDraft.printId === null ? '/api/prints' : `/api/prints/${printDraft.printId}`, {method:printDraft.printId === null ? 'POST' : 'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#print-name').value,print_date:$('#print-date').value,note:$('#print-note').value,status:$('#print-status').value,planned_project_id:printDraft.projectId,archive_file_id:$('#print-archive-file').value ? Number($('#print-archive-file').value) : null,duration_minutes:printDurationInput(),project_url:$('#print-project-url').value,image:printDraft.image,items:printDraft.items.map(item => ({filament_id:item.filament_id,grams:Number(item.grams)}))})});
      }
      if (!printDraft.wasteMode && $('#print-status').value === 'completed') await offerCompletedProjectDeletion(printDraft.printId,printDraft.projectId);
      $('#print-dialog').close(); await Promise.all([load(),loadUsage()]); if (printDraft.projectId != null) await loadProjects(); notify(printDraft.wasteMode ? t("ui.spildet_er_gemt_og_restvaegtene_er_opdateret_deb3e4") : printDraft.printId === null ? t("ui.printet_er_registreret_og_alle_restvaegte_er_opd_478eb1") : t("ui.printet_er_opdateret_og_alle_restvaegte_er_rette_47c6f3"));
    } catch(error) { $('#print-error').textContent = error.message; }
    finally { $('#print-save').disabled = false; }
  };
}

function plannedPrintLines(plate) {
  const quantity = plate.quantity ?? 1;
  const positive = value => typeof value === 'number' && value > 0;
  if (plate.filaments.length) return plate.filaments.map((line,index) => ({
    filament_id:-(index+1),
    label:t("ui.filament_733b5a", {p0: line.id, p1: line.type || t("ui.type_ikke_angivet_abd140"), p2: line.color ? ` · ${line.color}` : ''}),
    grams:plate.filaments.length === 1 && positive(plate.estimated_grams) ? plate.estimated_grams*quantity : positive(line.grams) ? line.grams*quantity : '',
  }));
  return positive(plate.estimated_grams) ? [{filament_id:-1,label:t("ui.projektets_samlede_forbrug_e644a5"),grams:plate.estimated_grams*quantity}] : [];
}
async function preparePlannedPrint(project) {
  if (project.print_id != null) throw new Error(t("ui.projektet_er_allerede_registreret_som_print_f01cd4"));
  await openPrintEditor();
  printDraft.projectId = project.id;
  $('#print-archive-file').value = project.archive_file_id == null ? '' : String(project.archive_file_id);
  $('#print-archive-file').disabled = project.archive_file_id != null;
  $('#print-name').value = project.name; $('#print-note').value = project.note; $('#print-project-url').value = project.project_url;
  $('#print-status').value = 'pending';
  const plate = project.metadata.plate;
  printDraft.items = plannedPrintLines(plate); renderPrintItems();
  const minutes = plate.estimated_seconds == null || plate.estimated_seconds <= 0 ? null : Math.ceil(plate.estimated_seconds*(plate.quantity ?? 1)/60);
  $('#print-hours').value = minutes == null ? '' : Math.floor(minutes/60); $('#print-minutes').value = minutes == null ? '' : minutes%60;
  printDraft.image = project.image;
  if (printDraft.image) { $('#print-image-preview').src = printDraft.image; $('#print-image-preview').hidden = false; $('#print-image-remove').hidden = false; }
  $('#planned-print-hints').hidden = false;
  $('#planned-print-hints').innerHTML = `<h3>${th("ui.estimat_fra_kommende_projekt_1616e9")}</h3><p>${th("ui.byggeplade_filament_vaelg_selv_de_konkrete_spole_a880ec", {p0: esc(plate.name), p1: esc(project.build_plate_name || t("ui.ikke_angivet_898bb9")), p2: esc((project.filament_types || []).join(', ') || t("ui.ikke_angivet_898bb9")), p3: plate.estimated_grams == null ? th("ui.gram_ikke_angivet_213d5c") : th("ui.g_i_alt_stk_ac5df4", {p0: number(plate.estimated_grams*(plate.quantity ?? 1)), p1: plate.quantity ?? 1})})}</p><ul>${plate.filaments.map(line => `<li>${th("ui.filament_8522c1", {p0: esc(line.id), p1: esc(line.type), p2: esc(line.color), p3: line.grams == null ? th("ui.gram_ikke_angivet_213d5c") : `${number(line.grams*(plate.quantity ?? 1))} g`})}</li>`).join('')}</ul>`;
  if (plate.filaments.length > 1 && plate.estimated_grams != null && Math.abs(printDraft.items.reduce((sum,item) => sum+(Number(item.grams)||0),0)-plate.estimated_grams*(plate.quantity ?? 1)) > 0.01) $('#print-error').textContent = t("ui.forbruget_pr_filament_afviger_fra_projektets_sam_a71815");
  updatePrintProjectLink();
  await renderPrintArchiveImages();
}

const PrintEditor = Object.freeze({open: (...args) => openPrintEditor(...args), openWaste: (...args) => openWasteEditor(...args), startProject: (...args) => preparePlannedPrint(...args)});

export { PrintEditor, initPrints };
