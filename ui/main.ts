import { createApp } from 'vue';
import App from './App.vue';
import OperatorConsole from './components/OperatorConsole.vue';
import './styles.css';
import './broadcast.css';
import './lazer-ribbons.css';

createApp(location.pathname === '/control' ? OperatorConsole : App).mount('#app');
