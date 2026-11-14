import { createApp } from 'vue';
import App from './App.vue';
import OperatorConsole from './components/OperatorConsole.vue';
import ShowcasePage from './components/ShowcasePage.vue';
import './styles.css';
import './broadcast.css';
import './lazer-ribbons.css';

createApp(location.pathname === '/control' ? OperatorConsole : location.pathname === '/showcase' ? ShowcasePage : App).mount('#app');
