const launcherOrigin = 'http://wails.localhost';

export const inDesktopLauncher = window.parent !== window &&
  new URLSearchParams(location.search).get('desktop') === '1' &&
  document.referrer === launcherOrigin + '/';

export function openDesktopLink(destination: string, edition = '') {
  window.parent.postMessage({ type: 'oclr-desktop-open', destination, edition }, launcherOrigin);
}

export function connectDesktopHost() {
  if (!inDesktopLauncher) return;
  const openLink = (event: MouseEvent) => {
    const link = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('a[data-desktop-link], a[data-desktop-page]') : null;
    if (!link || event.defaultPrevented) return;
    event.preventDefault();
    if (link.dataset.desktopPage) {
      window.parent.postMessage({ type: 'oclr-desktop-navigate', page: link.dataset.desktopPage }, launcherOrigin);
    } else if (link.dataset.desktopLink) {
      openDesktopLink(link.dataset.desktopLink, link.dataset.edition);
    }
  };
  document.addEventListener('click', openLink);
  document.addEventListener('auxclick', openLink);
  window.parent.postMessage({ type: 'oclr-desktop-ready' }, launcherOrigin);
}
