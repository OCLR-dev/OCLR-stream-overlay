import { createApp } from 'vue';
import App from './App.vue';
import OperatorConsole from './components/OperatorConsole.vue';
import ShowcasePage from './components/ShowcasePage.vue';
import ShowcaseCoverDemo from './components/ShowcaseCoverDemo.vue';
import ShowcaseCoverOutput from './components/ShowcaseCoverOutput.vue';
import './styles.css';
import './broadcast.css';
import './lazer-ribbons.css';

// Issue #57 local preview: /showcase?cover-demo=1 is a self-contained review page.
const coverDemo = location.pathname === '/showcase' && new URLSearchParams(location.search).has('cover-demo');
const coverOutput = location.pathname === '/showcase' && new URLSearchParams(location.search).get('layer') === 'cover';
createApp(location.pathname === '/control' ? OperatorConsole : coverDemo ? ShowcaseCoverDemo : coverOutput ? ShowcaseCoverOutput : location.pathname === '/showcase' ? ShowcasePage : App).mount('#app');
