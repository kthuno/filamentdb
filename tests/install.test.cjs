const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {loadFrontend} = require('./frontend-loader.cjs');
async function setup({installed=false}={}) {
  const reload = {hidden:true,addEventListener(name,handler){this[name]=handler;}};
  let reloadCount = 0;
  const media = {matches:installed,addEventListener(name,handler){this[name]=handler;}};
  const context=vm.createContext({window:{location:{reload(){reloadCount++;}},matchMedia:()=>media},document:{querySelector:selector=>selector === '#reload-app' ? reload : null}});
  const module=await loadFrontend(context,[],{entry:'install.js',init:false,exposeInternals:false});
  module.namespace.initInstall();
  return {media,reload,reloadCount:()=>reloadCount};
}
test('reload button is available only in standalone mode and reloads the current page', async () => {
  const browser = await setup();
  assert.equal(browser.reload.hidden,true);
  const app = await setup({installed:true});
  assert.equal(app.reload.hidden,false);
  app.reload.click();
  assert.equal(app.reloadCount(),1);
  browser.media.change({matches:true});
  assert.equal(browser.reload.hidden,false);
  browser.media.change({matches:false});
  assert.equal(browser.reload.hidden,true);
});
