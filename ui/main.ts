import { createApp } from 'vue';
import App from './App.vue';
import OperatorConsole from './components/OperatorConsole.vue';
import ShowcaseCoverDemo from './components/ShowcaseCoverDemo.vue';
import ShowcaseCoverOutput from './components/ShowcaseCoverOutput.vue';
import ShowcasePage from './components/ShowcasePage.vue';
import './styles.css';
import './broadcast.css';
import './lazer-ribbons.css';

const query = new URLSearchParams(location.search);
const showcase = location.pathname === '/showcase';
const coverDemo = showcase && query.has('cover-demo');
const coverOutput = showcase && query.get('layer') === 'cover';
if (showcase && !coverDemo && !coverOutput && query.get('clean') !== '1') {
  window.addEventListener('drop', event => {
    const types = event.dataTransfer?.types;
    if (types?.includes('Files') || types?.includes('text/uri-list')) event.preventDefault();
  });
}
createApp(location.pathname === '/control' ? OperatorConsole :
  coverDemo ? ShowcaseCoverDemo : coverOutput ? ShowcaseCoverOutput : showcase ? ShowcasePage : App).mount('#app');
