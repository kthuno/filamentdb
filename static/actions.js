import { t } from './i18n.js';
// Feature modules request coordinated work through callbacks registered at startup.
let handlers = Object.freeze({});
function configureAppActions(callbacks) {
  handlers = Object.freeze({...callbacks});
}
function runAction(name, args) {
  if (!handlers[name]) throw new Error(t("ui.appen_er_ikke_initialiseret_8f39f5")+name);
  return handlers[name](...args);
}
function load(...args) { return runAction("load", args); }
function loadUsage(...args) { return runAction("loadUsage", args); }
function switchView(...args) { return runAction("switchView", args); }
function edit(...args) { return runAction("edit", args); }
function loadProjects(...args) { return runAction("loadProjects", args); }
function loadFileArchive(...args) { return runAction("loadFileArchive", args); }
function offerCompletedProjectDeletion(...args) { return runAction("offerCompletedProjectDeletion", args); }

export { configureAppActions, edit, load, loadFileArchive, loadProjects, loadUsage, offerCompletedProjectDeletion, switchView };
