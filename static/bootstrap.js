import { startApp } from './app.js';
import { startupError } from './i18n.js';
startApp().catch(error => {
  console.error(error);
  const status=document.querySelector('#app-version');
  if(status)status.textContent=startupError();
});
