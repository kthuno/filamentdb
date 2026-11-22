// Browser menus handle installation; the manifest supplies app identity and icons.
function initInstall() {
  const reload = document.querySelector('#reload-app');
  const standalone = window.matchMedia('(display-mode: standalone)');
  reload.hidden = !standalone.matches;
  reload.addEventListener('click', () => window.location.reload());
  standalone.addEventListener('change', event => { reload.hidden = !event.matches; });
}

export { initInstall };
