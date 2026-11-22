import { t, th, getLocale } from './i18n.js';
import { edit } from './actions.js';
import { $, compareLocationNames, esc, formatPrintTime, number } from './core.js';
import { summarizeMaterials } from './inventory.js';
import { inventoryState, usageState } from './inventory-data.js';
import { PrintEditor } from './prints.js';
import { summarizeUsage, usageDate } from './usage-model.js';
// Dashboard inventory summary and consumption statistics.
function activeSpoolCard(spool) {
  const color = /^#[0-9a-f]{6}$/i.test(spool.color_hex) ? spool.color_hex : '#bd93f9';
  const percent = Math.max(0,Math.min(100,spool.remaining/spool.weight*100 || 0));
  return `<button type="button" class="active-spool${percent < 20 ? ' active-spool-low' : ''}" data-consume="${spool.id}" style="--filament:${color}" aria-label="${th("ui.registrer_forbrug_paa_gram_tilbage_64855f", {p3: esc(spool.name), p4: esc(spool.active_slot), p5: number(spool.remaining)})}"><span class="active-spool-slot"><i aria-hidden="true"></i>${esc(spool.active_slot)}</span><span class="active-spool-body"><span class="active-spool-art" aria-hidden="true"><span class="ams-reel${spool.transparency === 'transparent' ? ' ams-reel-transparent' : ''}"></span></span><span class="active-spool-info"><strong>${esc(spool.name)}</strong><span class="active-spool-material">${esc(spool.material)} · ${esc(spool.color || t("ui.ingen_farve_angivet_930385"))}</span><span class="active-spool-remaining">${number(spool.remaining)} <small>${th("ui.g_tilbage_3dfac7")}</small></span></span></span><span class="active-spool-meter"><span style="width:${percent}%"></span></span><span class="active-spool-bottom"><span>${th("ui.tilbage_44f103", {p13: number(percent,0)})}</span><span>${th("ui.registrer_forbrug_ff4446")}</span></span></button>`;
}
function renderUsageStatistics() {
  const stats = summarizeUsage(usageState.entries, $('#usage-statistics-year').value);
  $('#usage-statistics-summary').innerHTML = `<strong>${number(stats.grams)} g <small>${th("ui.samlet_forbrug_bb987d")}</small></strong><strong>${stats.registrations} <small>${th("ui.registreringer_4bf6f4")}</small></strong><strong>${stats.materials.length} <small>${th("ui.materialetyper_eb8635")}</small></strong><strong>${number(stats.wasteGrams)} g <small>${th("ui.heraf_spild_017121", {p4: number(stats.grams ? stats.wasteGrams/stats.grams*100 : 0,1)})}</small></strong>`;
  $('#usage-statistics-summary').innerHTML += `<strong>${esc(formatPrintTime(stats.printMinutes))} <small>${th("ui.registreret_printtid_af_print_a6369c", {p1: stats.timedPrintCount, p2: stats.printCount})}</small></strong><strong>${esc(formatPrintTime(stats.failedMinutes))} <small>${th("ui.heraf_fejlede_print_6c3f3a")}</small></strong><strong>${stats.timedPrintCount ? esc(formatPrintTime(Math.round(stats.printMinutes/stats.timedPrintCount))) : th("ui.ikke_angivet_898bb9")} <small>${th("ui.gennemsnit_pr_print_med_kendt_tid_6b4193")}</small></strong>`;
  function bars(rows, total, monthly = false, time = false) {
    if (!rows.length) return `<p>${th("ui.intet_registreret_forbrug_i_perioden_3f681d")}</p>`;
    const max = Math.max(...rows.map(row => row.grams));
    return `<ul class="usage-bars">${rows.map(row => {
      const label = monthly ? new Date(`${row.label}-01T12:00:00`).toLocaleDateString(getLocale(),{month:'short',year:'numeric'}) : row.label;
      return `<li><div><span>${esc(label)}</span><b>${time ? esc(formatPrintTime(row.grams)) : `${number(row.grams)} g`}${total ? ` <small>· ${number(row.grams/total*100,1)} %</small>` : ''}</b></div><div class="usage-bar" aria-hidden="true"><span style="width:${max ? row.grams/max*100 : 0}%"></span></div></li>`;
    }).join('')}</ul>`;
  }
  $('#usage-monthly').innerHTML = bars(stats.months,0,true);
  $('#usage-print-time').innerHTML = bars(stats.timeMonths,0,true,true);
  $('#usage-waste').innerHTML = bars(stats.waste,stats.wasteGrams);
  $('#usage-materials').innerHTML = bars(stats.materials,stats.grams);
  $('#usage-filaments').innerHTML = bars(stats.filaments.slice(0,5),0) + (stats.filaments.length > 5 ? `<p>${th("ui.de_fem_mest_anvendte_filamenter_i_perioden_77e65b")}</p>` : '');
}
function updateUsageStatisticsYears() {
  const picker = $('#usage-statistics-year');
  const years = [...new Set(usageState.entries.map(entry => usageDate(entry)?.slice(0,4)).filter(Boolean))].sort().reverse();
  const selected = picker.value;
  picker.innerHTML = `<option value="">${th("ui.alle_aar_a4eb2f")}</option>` + years.map(year => `<option value="${esc(year)}">${esc(year)}</option>`).join('');
  picker.value = years.includes(selected) ? selected : '';
}

function initDashboard() {
  $('#dashboard-add').onclick = () => edit();
  $('#dashboard-print').onclick = async () => {
    $('#dashboard-error').textContent = '';
    $('#dashboard-print').disabled = true;
    try { await PrintEditor.open(); }
    catch (error) { $('#dashboard-error').textContent = error.message; }
    finally { $('#dashboard-print').disabled = false; }
  };
  $('#usage-statistics-year').onchange = renderUsageStatistics;
}

function renderDashboard() {
  const inventory = inventoryState.spools.filter(spool => !spool.archived);
  $('#active-spools').innerHTML = inventory.filter(s => s.active_slot && s.remaining > 0).sort((a,b) => compareLocationNames(a.active_slot,b.active_slot)).map(activeSpoolCard).join('') || `<p>${th("ui.ingen_aktive_spoler_angiv_en_aktiv_plads_paa_en__d84114")}</p>`;
  const materials = summarizeMaterials(inventory);
  $('#total').textContent = inventory.length;
  $('#weight').innerHTML = `${number(inventoryState.spools.reduce((a,s) => a+s.remaining,0)/1000)} <em>kg</em>`;
  $('#physical-spools').textContent = inventory.filter(s => s.purchase_format === 'spool').length;
  $('#purchase-summary').textContent = t("ui.refill_ikke_angivet_5461ad", {p0: inventory.filter(s => s.purchase_format === 'refill').length, p1: inventory.filter(s => s.purchase_format === 'unknown').length});
  $('#materials').textContent = materials.length;
  $('#low').textContent = inventoryState.spools.filter(s => s.remaining > 0 && s.remaining/s.weight < .2).length;
}

export { initDashboard, renderDashboard, renderUsageStatistics, updateUsageStatisticsYears };
