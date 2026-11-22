// Local JSON catalogs; translations never change API codes or stored user data.
let currentLanguage = 'da';
let currentLocale = 'da-DK';
let messages = Object.create(null);
let fallbackMessages = Object.create(null);
let registry = {default:'da',languages:[{code:'da',name:'Dansk',locale:'da-DK'}]};
let initialized = false;
let initialization = null;
const categories = ['zero','one','two','few','many','other'];
const languageCode = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
function validateCatalog(catalog) {
  if (!catalog || !languageCode.test(catalog.language) || typeof catalog.locale !== 'string'
      || !catalog.messages || typeof catalog.messages !== 'object' || Array.isArray(catalog.messages)) throw new Error('Invalid language catalog');
  new Intl.NumberFormat(catalog.locale);
  const result=Object.create(null);
  for(const [key,value] of Object.entries(catalog.messages)) {
    if(typeof value === 'string') result[key]=value;
    else if(value && typeof value==='object' && !Array.isArray(value) && typeof value.other==='string'
      && Object.entries(value).every(([category,text])=>(categories.includes(category) && typeof text==='string') || (category==='countParam' && typeof text==='string' && /^[A-Za-z0-9_]+$/.test(text)))) result[key]=Object.freeze({...value});
    else throw new Error('Invalid translation: '+key);
  }
  return Object.freeze(result);
}
function configureI18n(catalog, fallback=catalog, languages=registry) {
  const base=validateCatalog(fallback), selected=validateCatalog(catalog);
  fallbackMessages=base;
  messages=selected;
  currentLanguage=catalog.language;
  currentLocale=catalog.locale;
  registry=languages;
  initialized=true;
}
function hasTranslation(key) { return Object.hasOwn(messages,key) || Object.hasOwn(fallbackMessages,key); }
function getLanguage() { return currentLanguage; }
function getLocale() { return currentLocale; }
function resolveMessage(key,params) {
  let value=Object.hasOwn(messages,key)?messages[key]:fallbackMessages[key];
  if(value && typeof value==='object') {
    const count=params[value.countParam || 'count'] ?? params.p0;
    const category=Number.isFinite(Number(count)) ? new Intl.PluralRules(currentLocale).select(Number(count)) : 'other';
    value=value[category] ?? value.other;
  }
  return typeof value==='string'?value:key;
}
function interpolate(value,params) {
  return value.replace(/\{([A-Za-z0-9_]+)\}/g,(token,name)=>Object.hasOwn(params,name)?String(params[name]??''):token);
}
function escapeMarkup(value) {
  return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function t(key,params={}) { return interpolate(resolveMessage(key,params),params); }
// Existing HTML expressions are already escaped at their insertion points.
// Escape catalog text before interpolation, so translators cannot add markup.
function th(key,params={}) { return interpolate(escapeMarkup(resolveMessage(key,params)),params); }
function tn(one,other,count,html=false) {
  const key=new Intl.PluralRules(currentLocale).select(Number(count))==='one'?one:other;
  return (html?th:t)(key,{count});
}
async function readJson(path) {
  const response=await fetch(path,{cache:'no-store'});
  if(!response.ok)throw new Error('Language file unavailable: '+path);
  return response.json();
}
async function loadLanguage(code) {
  const language=registry.languages.find(item=>item.code===code);
  if(!language || !languageCode.test(code))throw new Error('Unsupported language');
  const catalog=await readJson('/locales/'+code+'.json');
  if(catalog.language!==code)throw new Error('Language code mismatch');
  const selected=validateCatalog(catalog);
  messages=selected;
  currentLanguage=code;
  currentLocale=catalog.locale;
}
async function initI18n() {
  if(initialized)return;
  if(initialization)return initialization;
  initialization=(async()=>{
    const [languages,danish]=await Promise.all([readJson('/locales/index.json'),readJson('/locales/da.json')]);
    if(danish.language!=='da' || !Array.isArray(languages.languages) || languages.default!=='da'
      || !languages.languages.some(item=>item.code==='da')
      || !languages.languages.every(item=>languageCode.test(item.code) && typeof item.name==='string' && typeof item.locale==='string')) throw new Error('Invalid language registry');
    configureI18n(danish,danish,languages);
    let preferred='da';
    try { preferred=globalThis.localStorage?.getItem('filamentdb.language') || 'da'; } catch {}
    try { preferred=new URL(window.location.href).searchParams.get('lang') || preferred; } catch {}
    if(preferred!=='da' && languages.languages.some(item=>item.code===preferred)) {
      try { await loadLanguage(preferred); } catch { /* Keep the complete Danish fallback. */ }
    }
  })();
  try { await initialization; } finally { initialization=null; }
}
function translateDocument(root=globalThis.document) {
  if(!root)return;
  if(root.documentElement)root.documentElement.lang=currentLanguage;
  const manifest=root.querySelector?.('link[rel="manifest"]');
  if(manifest && typeof manifest.setAttribute==='function') manifest.setAttribute('href','/manifest.webmanifest?lang='+encodeURIComponent(currentLanguage));
  if(typeof root.querySelectorAll!=='function')return;
  for(const element of root.querySelectorAll('[data-i18n-text]')) {
    const nodes=[...element.childNodes].filter(node=>node.nodeType===3 && node.nodeValue.trim());
    for(const mapping of element.getAttribute('data-i18n-text').split('|')) {
      const colon=mapping.indexOf(':'), index=Number(mapping.slice(0,colon)), key=mapping.slice(colon+1);
      if(nodes[index])nodes[index].nodeValue=t(key);
    }
  }
  for(const attribute of ['placeholder','title','aria-label','alt']) {
    for(const element of root.querySelectorAll('[data-i18n-'+attribute+']')) element.setAttribute(attribute,t(element.getAttribute('data-i18n-'+attribute)));
  }
}
function initLanguagePicker() {
  const select=globalThis.document?.querySelector('#language-select');
  if(!select)return;
  select.innerHTML=registry.languages.map(item=>'<option value="'+escapeMarkup(item.code)+'">'+escapeMarkup(item.name)+'</option>').join('');
  select.value=currentLanguage;
  select.onchange=async()=>{
    if(select.value===currentLanguage)return;
    const previous=currentLanguage;
    try {
      await loadLanguage(select.value);
      try { globalThis.localStorage?.setItem('filamentdb.language',currentLanguage); } catch {}
      const url=new URL(window.location.href);
      url.searchParams.set('lang',currentLanguage);
      window.location.assign(url.href);
    } catch {
      select.value=previous;
      const error=document.querySelector('#language-error');
      if(error){error.hidden=false;error.textContent=t('language.load_error');}
    }
  };
}
function startupError() {
  return initialized?t('language.startup_error'):'Sprogfilerne kunne ikke indlæses. Genindlæs siden.';
}
export { configureI18n, getLanguage, getLocale, hasTranslation, initI18n, initLanguagePicker, loadLanguage, startupError, t, th, tn, translateDocument };
