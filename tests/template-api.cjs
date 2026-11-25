// In-memory HTTP fixture for the shared template API; no browser or printer access.
function templateAPI() {
  const records=new Map(),requests=[];let revision=0;
  const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>JSON.parse(JSON.stringify(body))});
  return {records,requests,async fetch(url,options={}) {
    requests.push({url,options});
    if(url==='/api/label-templates')return response(200,{templates:[...records.values()],app_version:'2.3.4'});
    const size=url.split('/').at(-1),body=JSON.parse(options.body||'{}'),existing=records.get(size);
    if((existing?.revision||null)!==body.expected_revision)return response(409,{error:'Conflict'});
    if(options.method==='DELETE')records.delete(size);
    else records.set(size,{version:1,size,revision:'server-'+(++revision),design:body.design});
    return response(200,{ok:true});
  }};
}
module.exports={templateAPI};
