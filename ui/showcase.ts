import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import type { PoolEntry } from './session';
import type { MapInfoSource } from './mapInfo';

export interface WebsitePool {
  id: string;
  version: number;
  name: string;
  updatedAt: string;
  round: { name: string };
  entryCount: number;
}
export interface WebsitePoolSelection {
  connection: string;
  edition: string;
  poolId: string;
  version: number;
}

export interface ShowcaseSnapshot {
  revision: number;
  poolToken: string;
  pool: PoolEntry[];
  poolText: string;
  websiteEnabled?: false;
  websitePool: (WebsitePool & { edition: string }) | null;
  websiteArtwork?: string | null;
  stageLabel: string;
  loadedPoolCount: number;
  loadedPoolToken: string;
  matchedId: string | null;
  currentMap: PoolEntry | null;
  mapParameters: MapInfoSource['mapParameters'];
  sourceStatus: 'unavailable' | 'tourney' | 'no-map' | 'no-pool' | 'ambiguous' | 'matched' | 'unmatched';
  error: string;
  transition?: { covered: boolean; instant: boolean; shown: string[]; lastMap: string | null };
}

export function useShowcase() {
  const snapshot = shallowRef<ShowcaseSnapshot | null>(null);
  const connection = ref('connecting');
  const busy = ref(false);
  const error = ref('');
  let events: EventSource | undefined;
  let lastReceived = 0;
  let watchdog: ReturnType<typeof setInterval>;
  let disposed = false;
  const apply = (value: ShowcaseSnapshot) => {
    if (disposed) return;
    if (snapshot.value && value.revision < snapshot.value.revision && connection.value === 'synced') return;
    snapshot.value = value;
    connection.value = 'synced';
    lastReceived = Date.now();
  };
  onMounted(() => {
    events = new EventSource('/api/showcase/events');
    events.addEventListener('snapshot', event => {
      try { apply(JSON.parse((event as MessageEvent).data)); } catch { connection.value = 'error'; }
    });
    events.addEventListener('heartbeat', () => { lastReceived = Date.now(); connection.value = 'synced'; });
    events.onerror = () => { connection.value = 'disconnected'; };
    watchdog = setInterval(() => { if (Date.now() - lastReceived > 10000) connection.value = 'disconnected'; }, 1500);
  });
  onUnmounted(() => { disposed = true; events?.close(); clearInterval(watchdog); });
  const command = async (type: 'pool-text' | 'use-loaded-pool' | 'stage-label' | 'import-website', fields: Record<string, unknown> = {}) => {
    if (busy.value || !snapshot.value || connection.value !== 'synced') return false;
    busy.value = true; error.value = '';
    try {
      const response = await fetch('/api/showcase', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poolToken: snapshot.value.poolToken, type, ...fields }), signal: AbortSignal.timeout(10000) });
      const value = await response.json();
      if (value.snapshot) apply(value.snapshot);
      if (!response.ok) throw new Error(value.error?.message || '图池未更新，请重试。');
      apply(value);
      return true;
    } catch (reason) {
      error.value = reason instanceof Error && /[\u3400-\u9fff]/.test(reason.message) ? reason.message : '连接中断，请核对图池列表后重试。';
      return false;
    } finally { busy.value = false; }
  };
  return { snapshot, connection, busy, error, command };
}
