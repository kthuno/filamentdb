import { t, th } from './i18n.js';
import { $, esc, formatPrintTime, notify, number, request } from './core.js';
import { PrintEditor } from './prints.js';
import { loadBuildPlates, loadPlanning, showProjectDraft } from './projects.js';
// Original model files have independent notes; projects keep their own estimates.
let archivedFiles = [];
let editingArchiveFile = null;
let archiveBusy = false;
let archiveEstimateDraft = {};
let archiveEstimatePlateIndex = 0;
function renderFileArchive() {
  const query = $('#file-search').value.trim().toLocaleLowerCase('da');
  const filtered = archivedFiles.filter(file => [file.name,file.filename,file.note].join(' ').toLocaleLowerCase('da').includes(query));
  $('#files-status').textContent = t("ui.af_filer_9c04c6", {p0: filtered.length, p1: archivedFiles.length});
  $('#files-list').innerHTML = filtered.map(file => `<article class="file-card" tabindex="0" data-edit-file="${file.id}" aria-label="${th("ui.rediger_4d69d1", {p1: esc(file.name)})}"><div class="file-card-icon" aria-hidden="true"><img class="file-card-thumbnail" src="/api/files/${file.id}/image" alt="" loading="lazy" decoding="async"><svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg></div><div class="file-card-content"><span class="ams-model">${th("ui.3mf_mb_4774a2", {p3: number(file.size_bytes/1024/1024)})}</span><h2>${esc(file.name)}</h2><p>${esc(file.filename)}</p><span class="file-print-status${file.print_count ? ' file-has-prints' : ''}">${file.print_count ? th("ui.printregistreringer_senest_c99c29", {p0: file.print_count, p1: esc(file.last_print_date)}) : th("ui.ingen_printregistreringer_6617aa")}</span><small>${th("ui.tilknyttede_projekter_af8bc0", {p8: file.project_count})}</small><div class="file-actions"><button type="button" data-file-project="${file.id}">${th("ui.opret_projekt_ac3392")}</button><button type="button" class="danger" data-delete-file="${file.id}">${th("ui.slet_b9f4c0")}</button><a class="file-source-link file-card-download" href="/api/files/${file.id}/download" download>${th("ui.download_8b8d3a")}</a></div></div></article>`).join('') || `<p>${archivedFiles.length ? th("ui.ingen_filer_matcher_soegningen_f512bb") : th("ui.ingen_filer_endnu_upload_en_eller_flere_3mf_file_fa49d4")}</p>`;
}
async function loadFileArchive({openLinkedFile=true}={}) {
  $('#files-error').textContent = '';
  try {
    archivedFiles = await request('/api/files');
    renderFileArchive();
    const match = window.location.hash.match(/^#files\/(\d+)$/);
    if (openLinkedFile && match && (!$('#file-dialog').open || editingArchiveFile?.id !== Number(match[1]))) await openArchiveFile(Number(match[1]));
  } catch(error) { $('#files-error').textContent = error.message; }
}
function archiveMetadataHtml(file) {
  const meta = file.metadata;
  const value = text => esc(text || t("ui.ikke_angivet_898bb9"));
  const properties = [[t("ui.designer_8b6d8e"),meta.designer],[t("ui.licens_8a81b7"),meta.license],[t("ui.slicer_f8f1ff"),meta.application],[t("ui.printer_024eac"),meta.printer],[t("ui.laghoejde_d2bb45"),meta.layer_height],[t("ui.fyld_499cf1"),meta.infill]];
  return `<dl class="file-properties">${properties.map(([label,text]) => `<div><dt>${esc(label)}</dt><dd>${value(text)}</dd></div>`).join('')}</dl><details><summary>${th("ui.filidentitet_og_datoer_c241d6")}</summary><p>${th("ui.sha_256_b38416")}<code class="file-hash">${esc(file.sha256)}</code></p><p>${th("ui.uploadet_senest_aendret_a728b8", {p2: esc(file.created_at), p3: esc(file.updated_at)})}</p></details><h4>${th("ui.printplader_16f96f", {p4: meta.plates.length})}</h4>${meta.plates.map(plate => `<details class="file-plate"><summary>${esc(plate.name)} · ${plate.estimated_grams == null ? th("ui.ukendt_forbrug_4f4969") : `${number(plate.estimated_grams)} g`} · ${esc(formatPrintTime(plate.estimated_seconds == null ? null : Math.ceil(plate.estimated_seconds/60)))}</summary><p>${th("ui.objekter_1ca5e7", {p3: esc(plate.objects.filter(Boolean).join(', ') || t("ui.ikke_angivet_898bb9"))})}</p><ul>${plate.filaments.map(line => `<li>${esc(line.type || t("ui.ukendt_type_bd9d55"))} · ${esc(line.color)} · ${line.grams == null ? th("ui.ukendt_forbrug_4f4969") : `${number(line.grams)} g`}</li>`).join('') || `<li>${th("ui.intet_beregnet_forbrug_pr_filament_b18acd")}</li>`}</ul></details>`).join('')}<details class="file-plate"><summary>${th("ui.konfigurerede_filamenter_ikke_noedvendigvis_anve_6dceda")}</summary><ul>${meta.configured_filaments.map(line => `<li>${esc(line.profile || line.type)} · ${esc(line.color)} · ${esc(line.vendor || '')}</li>`).join('') || `<li>${th("ui.ikke_angivet_898bb9")}</li>`}</ul></details><p class="file-estimate-note">${esc((meta.warnings || []).join(' '))}</p>`;
}
function renderArchiveEstimate() {
  const plate = editingArchiveFile.metadata.plates[archiveEstimatePlateIndex];
  const image = $('#file-preview-image');
  image.alt = t("ui.forhaandsvisning_af_201f2b", {p0: plate.name});
  image.hidden = false;
  $('#file-preview-empty').hidden = true;
  image.src = `/api/files/${editingArchiveFile.id}/image?plate=${encodeURIComponent(plate.id)}`;
  const estimate = archiveEstimateDraft[plate.id] || {};
  const minutes = estimate.estimated_seconds == null ? null : Math.ceil(estimate.estimated_seconds/60);
  const sourceMinutes = plate.estimated_seconds == null ? null : Math.ceil(plate.estimated_seconds/60);
  $('#file-estimate-hours').value = minutes == null ? '' : Math.floor(minutes/60);
  $('#file-estimate-minutes').value = minutes == null ? '' : minutes%60;
  $('#file-estimate-grams').value = estimate.estimated_grams ?? '';
  $('#file-estimate-hours').placeholder = sourceMinutes == null ? t("ui.ikke_angivet_898bb9") : String(Math.floor(sourceMinutes/60));
  $('#file-estimate-minutes').placeholder = sourceMinutes == null ? t("ui.ikke_angivet_898bb9") : String(sourceMinutes%60);
  $('#file-estimate-grams').placeholder = plate.estimated_grams == null ? t("ui.ikke_angivet_898bb9") : String(plate.estimated_grams);
  $('#file-estimate-source').textContent = t("ui.fra_3mf_filen_a8afb5", {p0: formatPrintTime(sourceMinutes), p1: plate.estimated_grams == null ? t("ui.forbrug_ikke_angivet_1eab3b") : `${number(plate.estimated_grams)} g`});
}
function rememberArchiveEstimate() {
  const plate = editingArchiveFile.metadata.plates[archiveEstimatePlateIndex];
  const hours = $('#file-estimate-hours').value, minutes = $('#file-estimate-minutes').value;
  if ([hours,minutes].some(value => value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 0)) || Number(minutes) > 59) throw new Error(t("ui.angiv_hele_timer_og_minutter_fra_0_til_59_c912ca"));
  let seconds = hours === '' && minutes === '' ? null : (Number(hours || 0)*60+Number(minutes || 0))*60;
  if (seconds > 100000000) throw new Error(t("ui.forventet_tid_maa_hoejst_vaere_100_000_000_sekun_319a70"));
  const previous = archiveEstimateDraft[plate.id]?.estimated_seconds;
  if (previous != null && seconds === Math.ceil(previous/60)*60) seconds = previous;
  const grams = $('#file-estimate-grams').value === '' ? null : Number($('#file-estimate-grams').value);
  if (grams != null && (!Number.isFinite(grams) || grams < 0 || grams > 1000000)) throw new Error(t("ui.forventet_forbrug_skal_vaere_mellem_0_og_1_000_0_7db4af"));
  if (seconds == null && grams == null) delete archiveEstimateDraft[plate.id];
  else archiveEstimateDraft[plate.id] = {estimated_seconds:seconds,estimated_grams:grams};
}
async function saveArchiveEdits() {
  rememberArchiveEstimate();
  await request(`/api/files/${editingArchiveFile.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#file-name').value,note:$('#file-note').value,plate_estimates:archiveEstimateDraft})});
  editingArchiveFile.name = $('#file-name').value; editingArchiveFile.note = $('#file-note').value;
  editingArchiveFile.plate_estimates = JSON.parse(JSON.stringify(archiveEstimateDraft));
}
async function openArchiveFile(id) {
  const file = await request(`/api/files/${id}`);
  editingArchiveFile = file;
  archiveEstimateDraft = Object.assign(Object.create(null), file.plate_estimates || {});
  archiveEstimatePlateIndex = 0;
  $('#file-estimate-plate').innerHTML = file.metadata.plates.map((plate,index) => `<option value="${index}">${esc(plate.name)} (${esc(plate.id)})</option>`).join('');
  $('#file-estimate-plate').value = '0'; renderArchiveEstimate();
  $('#file-name').value = file.name;
  $('#file-note').value = file.note;
  $('#file-filename').textContent = t("ui.mb_6e81d8", {p0: file.filename, p1: number(file.size_bytes/1024/1024)});
  $('#file-download').href = `/api/files/${file.id}/download`;
  $('#file-metadata').innerHTML = archiveMetadataHtml(file);
  $('#file-projects').innerHTML = file.projects.map(project => `<p><button type="button" data-linked-project="${project.id}">${esc(project.name)}</button> · ${project.print_id == null ? th("ui.kommende_projekt_3ecda5") : th("ui.registreret_som_print_1981d2")}</p>`).join('') || `<p>${th("ui.ingen_tilknyttede_projekter_endnu_dfccc0")}</p>`;
  const statuses = {pending:t("ui.afventer_ecd979"),in_progress:t("ui.igangvaerende_11ccd3"),completed:t("ui.gennemfoert_183bb5"),failed:t("ui.fejlet_2c98b9")};
  $('#file-prints').innerHTML = (file.prints || []).map(printing => `<div class="file-print-record"><button type="button" data-linked-print="${printing.id}">${esc(printing.name)}</button><span>${esc(printing.print_date)} · ${esc(statuses[printing.status] || printing.status)}</span></div>`).join('') || `<p>${th("ui.ingen_printregistreringer_med_denne_fil_endnu_ed5b44")}</p>`;
  $('#file-error').textContent = '';
  $('#file-dialog').showModal();
}
async function createProjectFromArchive(id) {
  const draft = await request(`/api/files/${id}/preview`);
  await Promise.all([loadBuildPlates(),loadPlanning()]);
  $('#file-dialog').close();
  showProjectDraft(draft);
}
async function removeArchiveFile(id) {
  if (!confirm(t("ui.slet_originalfilen_og_dens_arkivnoter_tilknytted_63eab0"))) return false;
  await request(`/api/files/${id}`,{method:'DELETE'});
  if (editingArchiveFile?.id === id) { $('#file-dialog').close(); editingArchiveFile = null; }
  if (window.location.hash === `#files/${id}`) window.location.hash = '#files';
  await loadFileArchive();
  return true;
}

function initFiles() {
  $('#files-list').addEventListener('error', event => {
    if (event.target.matches('.file-card-thumbnail')) event.target.hidden = true;
  }, true);
  $('#file-preview-image').onerror = () => {
    $('#file-preview-image').hidden = true;
    $('#file-preview-empty').hidden = false;
  };

  $('#file-prints').onclick = async event => {
    const button=event.target.closest('[data-linked-print]');
    if(!button) return;
    button.disabled=true;
    try {
      await PrintEditor.open(Number(button.dataset.linkedPrint));
      $('#file-dialog').close();
      window.location.hash='#usage';
    } catch(error) { $('#file-error').textContent=error.message; }
    finally { button.disabled=false; }
  };
  $('#file-estimate-plate').onchange = event => {
    $('#file-error').textContent = '';
    try { rememberArchiveEstimate(); archiveEstimatePlateIndex = Number(event.target.value); renderArchiveEstimate(); }
    catch(error) { event.target.value = String(archiveEstimatePlateIndex); $('#file-error').textContent = error.message; }
  };
  $('#file-search').oninput = renderFileArchive;
  $('#archive-file-upload').onchange = async event => {
    const files = Array.from(event.target.files || []);
    if (!files.length || archiveBusy) return;
    archiveBusy = true; event.target.disabled = true;
    $('#files-error').textContent = ''; $('#files-upload-errors').textContent = '';
    const errors = [];
    let completed = 0;
    try {
      for (const [index,file] of files.entries()) {
        $('#files-upload-status').textContent = t("ui.indlaeser_af_6e6061", {p0: index+1, p1: files.length, p2: file.name});
        try {
          if (!file.name.toLowerCase().endsWith('.3mf') || file.size > 30*1024*1024) throw new Error(t("ui.vaelg_en_3mf_fil_paa_hoejst_30_mb_c3cc0f"));
          await request('/api/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},body:file});
          completed++;
        } catch(error) { errors.push(`${file.name}: ${error.message}`); }
      }
      if (completed) await loadFileArchive({openLinkedFile:false});
      $('#files-upload-status').textContent = t("ui.indlaest_af_filer_729026", {p0: completed, p1: files.length, p2: errors.length ? t("ui.kunne_ikke_indlaeses_2e6c52", {p0: errors.length}) : ''});
      $('#files-upload-errors').textContent = errors.join('\n');
    } finally { archiveBusy = false; event.target.disabled = false; event.target.value = ''; }
  };
  $('#files-list').onclick = async event => {
    if (archiveBusy || event.target.closest('a')) return;
    const button = event.target.closest('button');
    const card = event.target.closest('[data-edit-file]');
    if (!button && !card) return;
    archiveBusy = true; if (button) button.disabled = true; $('#files-error').textContent = '';
    try {
      if (button?.dataset.fileProject) await createProjectFromArchive(Number(button.dataset.fileProject));
      else if (button?.dataset.deleteFile) await removeArchiveFile(Number(button.dataset.deleteFile));
      else if (!button && card) await openArchiveFile(Number(card.dataset.editFile));
    } catch(error) { $('#files-error').textContent = error.message; }
    finally { archiveBusy = false; if (button) button.disabled = false; }
  };
  $('#files-list').onkeydown = event => {
    if (!['Enter',' '].includes(event.key) || !event.target.matches('[data-edit-file]')) return;
    event.preventDefault(); event.target.click();
  };
  $('#file-form').onsubmit = async event => {
    event.preventDefault(); if (archiveBusy || !editingArchiveFile) return;
    archiveBusy = true; $('#file-save').disabled = true; $('#file-error').textContent = '';
    try {
      await saveArchiveEdits();
      await loadFileArchive(); $('#file-dialog').close(); notify(t("ui.filens_aendringer_er_gemt_97b30d"));
    } catch(error) { $('#file-error').textContent = error.message; }
    finally { archiveBusy = false; $('#file-save').disabled = false; }
  };
  $('#file-close').onclick = () => { if (!archiveBusy) $('#file-dialog').close(); };
  $('#file-dialog').addEventListener('cancel', event => { if (archiveBusy) event.preventDefault(); });
  $('#file-create-project').onclick = async () => {
    if (archiveBusy || !editingArchiveFile) return;
    archiveBusy = true; $('#file-error').textContent = '';
    try { await saveArchiveEdits(); await createProjectFromArchive(editingArchiveFile.id); }
    catch(error) { $('#file-error').textContent = error.message; }
    finally { archiveBusy = false; }
  };
  $('#file-delete').onclick = async () => {
    if (archiveBusy || !editingArchiveFile) return;
    archiveBusy = true; $('#file-error').textContent = '';
    try { await removeArchiveFile(editingArchiveFile.id); }
    catch(error) { $('#file-error').textContent = error.message; }
    finally { archiveBusy = false; }
  };
  $('#file-projects').onclick = async event => {
    const button = event.target.closest('[data-linked-project]');
    if (!button || archiveBusy) return;
    archiveBusy = true; $('#file-error').textContent = '';
    try {
      const project = await request(`/api/projects/${button.dataset.linkedProject}`);
      await Promise.all([loadBuildPlates(),loadPlanning()]);
      $('#file-dialog').close();
      if (project.print_id != null) { window.location.hash = '#usage'; await PrintEditor.open(project.print_id); }
      else {
        const {plate,...metadata} = project.metadata;
        showProjectDraft({...metadata,archive_file_id:project.archive_file_id,name:project.name,note:project.note,project_url:project.project_url,filament_types:project.filament_types,build_plate_id:project.build_plate_id,plates:[{...plate,thumbnail:project.image}],warnings:[]},project.id);
      }
    } catch(error) { $('#file-error').textContent = error.message; }
    finally { archiveBusy = false; }
  };
}

export { initFiles, loadFileArchive };
