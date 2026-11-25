// Pure browser-local filtering and pagination. Never changes inventory filters.
export const LABEL_PAGE_SIZE=12;
export function labelSearchText(value) {
  return String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/æ/g,'ae').replace(/ø/g,'oe');
}
export function filterLabelSpools(spools,{search='',material='',manufacturer=''}={}) {
  const terms=labelSearchText(search).trim().split(/\s+/).filter(Boolean);
  return spools.filter(spool=>{
    if(material && spool.material!==material || manufacturer && spool.manufacturer!==manufacturer)return false;
    const text=labelSearchText([spool.id,'#'+spool.id,'#'+String(spool.id).padStart(4,'0'),spool.name,spool.material,spool.manufacturer,spool.color,spool.color_hex,spool.product_id,spool.location,spool.active_slot].filter(value=>value!=null).join(' '));
    return terms.every(term=>text.includes(term));
  });
}
export function labelListPage(records,page=0) {
  const pages=Math.max(1,Math.ceil(records.length/LABEL_PAGE_SIZE));
  const index=Math.max(0,Math.min(Number.isInteger(page)?page:0,pages-1));
  return {records:records.slice(index*LABEL_PAGE_SIZE,(index+1)*LABEL_PAGE_SIZE),index,pages,total:records.length};
}
