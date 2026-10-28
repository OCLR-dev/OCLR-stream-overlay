import { BroadcastData } from './broadcast.js';

export { BroadcastData, findPoolEntry } from './broadcast.js';
export { OclrClient, OclrError } from './oclr.js';
export { TosuClient, normalizeTosuV2 } from './tosu.js';

export async function createBroadcastData(options = {}) {
  let config = options.config;
  if (!config) {
    const response = await fetch('/api/config', { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    config = await response.json();
  }
  return new BroadcastData({ tosuWsUrl: config.tosuWsUrl, ...options });
}
