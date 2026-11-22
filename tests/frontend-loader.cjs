const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'../static');

// Execute the real ES-module graph in an isolated DOM fixture. Legacy regression
// tests additionally inspect private bindings through a test-only evaluation hook;
// no such hook is present in the browser or native-import isolation tests.
async function loadFrontend(context, extras = [], {entry='app.js', init=true, exposeInternals=true}={}) {
  if (!vm.SourceTextModule) throw new Error('Run module fixtures with node --experimental-vm-modules --test tests/*.test.cjs');
  if (!context.document && context.$) context.document={querySelector:context.$};
  if (context.window) {
    context.location ||= context.window.location;
    context.window.matchMedia ||= ()=>({matches:false,addEventListener(){}});
  }
  const previous = Object.getOwnPropertyDescriptors(context);
  const modules = new Map(), bindings = new Map();
  function getModule(filename) {
    filename=path.resolve(filename);
    if (modules.has(filename)) return modules.get(filename);
    let source=fs.readFileSync(filename,'utf8');
    if (exposeInternals && !filename.endsWith('qrcodegen.js')) {
      const own=[];
      for (const match of source.matchAll(/^(?:export )?(?:(async) )?function ([$\w]+)|^(?:export )?(const|let|var) ([^;\n]+)/gm)) {
        if (match[2]) own.push({name:match[2],mutable:true});
        else {
          for (const variable of match[4].matchAll(/(?:^|,)\s*([$\w]+)\s*=/g)) own.push({name:variable[1],mutable:match[3]!=='const'});
        }
      }
      bindings.set(filename,own);
      source+='\nexport const __testBindings = {get: name => eval(name), set: (name, replacement) => eval(name+" = replacement")};\n';
    }
    const module=new vm.SourceTextModule(source,{context,identifier:filename});
    modules.set(filename,module);
    return module;
  }
  const main=getModule(path.join(root,entry));
  await main.link((specifier, referencing)=>getModule(path.resolve(path.dirname(referencing.identifier),specifier)));
  await main.evaluate();
  const language=modules.get(path.join(root,'i18n.js'));
  if(exposeInternals && language) {
    const catalog=JSON.parse(fs.readFileSync(path.join(root,'locales/da.json'),'utf8'));
    const registry=JSON.parse(fs.readFileSync(path.join(root,'locales/index.json'),'utf8'));
    language.namespace.configureI18n(catalog,catalog,registry);
  }
  if (exposeInternals) {
    for (const [filename, own] of bindings) {
      if (filename.endsWith('/actions.js')) continue;
      const hook=modules.get(filename).namespace.__testBindings;
      for (const {name,mutable} of own) {
        // Fixtures may seed data without adding a mutation API to production.
        const target=name==='inventoryState'?'inventorySnapshot':name==='usageState'?'usageSnapshot':name;
        Object.defineProperty(context,name,{configurable:true,
          get:()=>hook.get(target),
          set:value=>{if(!mutable)throw new TypeError('Private const binding: '+name);hook.set(target,value);},
        });
        if (mutable && previous[name] && 'value' in previous[name]) hook.set(target,previous[name].value);
      }
    }
  }
  if (init) {
    const app=modules.get(path.join(root,'app.js'));
    if (app) app.namespace.initApp();
  }
  return {namespace:main.namespace, modules, get:name=>modules.get(path.join(root,name)).namespace};
}
module.exports={loadFrontend};
