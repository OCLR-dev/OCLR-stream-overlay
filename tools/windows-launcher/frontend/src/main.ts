import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
// Files dropped outside a Showcase Slot must never navigate the launcher away.
window.addEventListener('drop', event => {
  const types = event.dataTransfer?.types;
  if (types?.includes('Files') || types?.includes('text/uri-list')) event.preventDefault();
});
createApp(App).mount('#app');
