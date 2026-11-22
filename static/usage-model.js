import { t, getLocale } from './i18n.js';
// Pure consumption calculations: no DOM, network or application state.
const wasteReasons = {get failed_print() { return t("ui.fejlet_print_c97a21"); },get purge() { return t("ui.purge_farveskift_9d2dbc"); },get calibration() { return t("ui.kalibrering_b93129"); },get other() { return t("ui.andet_spild_26668b"); }};
function groupUsage(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.waste_id != null ? `waste-${entry.waste_id}` : entry.print_id == null ? `usage-${entry.id}` : `print-${entry.print_id}`;
    if (!groups.has(key)) groups.set(key, {project: entry.print_id != null, waste:entry.waste_id != null, entry, grams: 0, items: []});
    const group = groups.get(key);
    group.grams += entry.grams;
    group.items.push(entry);
  }
  return [...groups.values()];
}
// Aggregate consumption lines directly: a multi-spool print contributes each line once.
function usageDate(entry) {
  return entry.waste_id != null ? entry.waste_date : entry.print_id != null ? entry.print_date : entry.created_at?.slice(0, 10);
}
function summarizeUsage(entries, year = '') {
  const selected = entries.filter(entry => !year || usageDate(entry)?.slice(0,4) === year);
  const months = new Map(), materials = new Map(), filaments = new Map(), waste = new Map();
  function add(map, key, label, grams) {
    if (!map.has(key)) map.set(key, {label, grams:0});
    map.get(key).grams += grams;
  }
  const normalized = value => (value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('da');
  for (const entry of selected) {
    const reason = entry.waste_id != null ? entry.waste_reason : entry.print_status === 'failed' ? 'failed_print' : null;
    if (reason) add(waste, reason, wasteReasons[reason] || t("ui.andet_spild_26668b"), entry.grams);
    const month = usageDate(entry)?.slice(0,7);
    if (month) add(months, month, month, entry.grams);
    add(materials, normalized(entry.material), entry.material?.trim() || t("ui.ikke_angivet_898bb9"), entry.grams);
    // Combine matching products across physical rolls, retaining color and material differences.
    const values = [entry.manufacturer, entry.name, entry.material, entry.color];
    add(filaments, JSON.stringify(values.map(normalized)), values.filter(Boolean).join(' · '), entry.grams);
  }
  // Duration belongs to the project, so count it once even when several spools were used.
  const timedPrints = groupUsage(selected).filter(group => group.project && group.entry.duration_minutes != null);
  const timeMonths = new Map();
  for (const group of timedPrints) {
    const month = usageDate(group.entry).slice(0,7);
    add(timeMonths,month,month,group.entry.duration_minutes);
  }
  const byWeight = map => [...map.values()].sort((a,b) => b.grams-a.grams || a.label.localeCompare(b.label,getLocale()));
  return {
    grams:selected.reduce((sum,entry) => sum+entry.grams,0),
    registrations:groupUsage(selected).length,
    printMinutes:timedPrints.reduce((sum,group) => sum+group.entry.duration_minutes,0),
    failedMinutes:timedPrints.filter(group => group.entry.print_status === 'failed').reduce((sum,group) => sum+group.entry.duration_minutes,0),
    timedPrintCount:timedPrints.length,
    printCount:groupUsage(selected).filter(group => group.project).length,
    timeMonths:[...timeMonths.values()].sort((a,b) => a.label.localeCompare(b.label)),
    wasteGrams:[...waste.values()].reduce((sum,row) => sum+row.grams,0), waste:byWeight(waste),
    months:[...months.values()].sort((a,b) => a.label.localeCompare(b.label)),
    materials:byWeight(materials), filaments:byWeight(filaments),
  };
}
function recentMonthlyUsage(entries, now = new Date()) {
  const months = Array.from({length:6}, (_,index) => {
    const date = new Date(now.getFullYear(),now.getMonth()-5+index,1);
    return {key:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`,label:date.toLocaleDateString(getLocale(),{month:'short',year:'2-digit'}),grams:0};
  });
  for (const entry of entries) {
    const month = months.find(month => month.key === usageDate(entry)?.slice(0,7));
    if (month) month.grams += entry.grams;
  }
  return months;
}
function normalizeUsageText(value) {
  return String(value || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('da');
}
function filterUsageGroups(entries, filters) {
  const query = normalizeUsageText(filters.query);
  return groupUsage(entries).filter(group => {
    const date = usageDate(group.entry) || '';
    if ((filters.from && date < filters.from) || (filters.to && date > filters.to)) return false;
    // Match material and spool on the same line, but retain the complete project card.
    if (!group.items.some(item => (!filters.material || normalizeUsageText(item.material) === filters.material)
        && (!filters.spool || String(item.filament_id) === filters.spool))) return false;
    const text = group.items.flatMap(item => [item.project_name,item.project_note,item.waste_note,item.linked_project_name,wasteReasons[item.waste_reason],item.note,item.name,item.manufacturer,item.material,item.color,item.filament_id]).join(' ');
    return !query || normalizeUsageText(text).includes(query);
  });
}
function sortUsageGroups(groups, sort = 'date', direction = 'desc') {
  const sign = direction === 'asc' ? 1 : -1;
  const label = group => group.waste ? t("ui.spild_60336a", {p0: wasteReasons[group.entry.waste_reason] || t("ui.andet_spild_26668b")}) : group.project ? group.entry.project_name : group.entry.name;
  return [...groups].sort((a,b) => {
    let compared;
    if (sort === 'grams') compared = a.grams-b.grams;
    else if (sort === 'name') compared = (label(a) || '').localeCompare(label(b) || '', getLocale(), {numeric:true,sensitivity:'base'});
    else compared = (usageDate(a.entry) || '').localeCompare(usageDate(b.entry) || '');
    return sign*compared || b.entry.id-a.entry.id;
  });
}

export { filterUsageGroups, groupUsage, normalizeUsageText, recentMonthlyUsage, sortUsageGroups, summarizeUsage, usageDate, wasteReasons };
