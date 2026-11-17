import { createApp } from 'vue';
import App from './App.vue';
import OperatorConsole from './components/OperatorConsole.vue';
import ShowcasePage from './components/ShowcasePage.vue';
import ShowcaseCoverDemo from './components/ShowcaseCoverDemo.vue';
import './styles.css';
import './broadcast.css';
import './lazer-ribbons.css';

// Issue #57 local preview: /showcase?cover-demo=1 is a self-contained review page.
const coverDemo = location.pathname === '/showcase' && new URLSearchParams(location.search).has('cover-demo');
createApp(location.pathname === '/control' ? OperatorConsole : coverDemo ? ShowcaseCoverDemo : location.pathname === '/showcase' ? ShowcasePage : App).mount('#app');
