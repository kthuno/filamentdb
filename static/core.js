import { t, getLocale, getLanguage, hasTranslation } from './i18n.js';
// Shared DOM, formatting, URL and HTTP helpers.
const $ = s => document.querySelector(s);
const purchaseLabel = value => ({spool: t("ui.med_spole_405e1f"), refill: t("ui.refill_628046"), unknown: t("ui.ikke_angivet_898bb9")}[value] || t("ui.ikke_angivet_898bb9"));
const productLink = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
const number = (n, decimals = 2) => new Intl.NumberFormat(getLocale(), {maximumFractionDigits: decimals}).format(n);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
async function request(url, options) { const response = await fetch(url, {...options, headers:{...options?.headers, "Accept-Language":getLanguage()}}); const data = await response.json(); if (!response.ok) throw new Error((data.error_key && hasTranslation(data.error_key) ? t(data.error_key,data.error_params || {}) : data.error) || t("ui.der_opstod_en_fejl_proev_igen_05e156")); return data; }
function compareLocationNames(a,b) {
  return (a || '').localeCompare(b || '', getLocale(), {numeric:true});
}
function compareLocations(a,b) {
  return Number(!a.location) - Number(!b.location) || compareLocationNames(a.location,b.location) || a.id-b.id;
}

function formatPrintTime(minutes) {
  return minutes == null ? t("ui.ikke_angivet_898bb9") : t("ui.t_min_221798", {p0: number(Math.floor(minutes/60),0), p1: number(Math.round(minutes%60),0)});
}

export { $, compareLocationNames, compareLocations, esc, formatPrintTime, notify, number, productLink, purchaseLabel, request };
