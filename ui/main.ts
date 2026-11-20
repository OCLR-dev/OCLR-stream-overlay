import { createApp } from 'vue';
import App from './App.vue';
import OperatorConsole from './components/OperatorConsole.vue';
import DesktopLogin from './components/DesktopLogin.vue';
import { connectDesktopHost } from './desktopHost';
import ShowcasePage from './components/ShowcasePage.vue';
import ShowcaseCoverDemo from './components/ShowcaseCoverDemo.vue';
import ShowcaseCoverOutput from './components/ShowcaseCoverOutput.vue';
import './styles.css';
import './broadcast.css';
import './lazer-ribbons.css';

// Issue #57 local preview: /showcase?cover-demo=1 is a self-contained review page.
const coverDemo = location.pathname === '/showcase' && new URLSearchParams(location.search).has('cover-demo');
const coverOutput = location.pathname === '/showcase' && new URLSearchParams(location.search).get('layer') === 'cover';
const desktopLogin = location.pathname === '/control' && window.parent === window &&
  new URLSearchParams(location.search).has('desktop-login');
createApp(desktopLogin ? DesktopLogin : location.pathname === '/control' ? OperatorConsole :
  coverDemo ? ShowcaseCoverDemo : coverOutput ? ShowcaseCoverOutput : location.pathname === '/showcase' ? ShowcasePage : App).mount('#app');
if (window.parent !== window || (location.pathname === '/showcase' && !coverDemo && !coverOutput)) {
  // The embedded Showcase rows handle files. Cancel the WebView's navigation default.
  window.addEventListener('drop', event => {
    const types = event.dataTransfer?.types;
    if (types?.includes('Files') || types?.includes('text/uri-list')) event.preventDefault();
  });
}
connectDesktopHost();
