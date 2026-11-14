import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import type { PoolEntry } from './session';
import type { MapInfoSource } from './mapInfo';

export interface ShowcaseSnapshot {
  revision: number;
  poolToken: string;
  pool: PoolEntry[];
  selectedId: string | null;
  currentMap: PoolEntry | null;
  mapParameters: MapInfoSource['mapParameters'];
  useTosu: boolean;
  sourceStatus: 'off' | 'unavailable' | 'tourney' | 'different-map' | 'matched';
  edition: string | null;
  error: string;
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
  const select = async (selectedId: string | null, useTosu = snapshot.value?.useTosu || false) => {
    if (busy.value || !snapshot.value || connection.value !== 'synced') return;
    busy.value = true; error.value = '';
    try {
      const response = await fetch('/api/showcase', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poolToken: snapshot.value.poolToken, selectedId, useTosu }), signal: AbortSignal.timeout(10000) });
      const value = await response.json();
      if (value.snapshot) apply(value.snapshot);
      if (!response.ok) throw new Error(value.error?.message || '展示谱面未更新，请重试。');
      apply(value);
    } catch (reason) {
      error.value = reason instanceof Error && /[\u3400-\u9fff]/.test(reason.message) ? reason.message : '连接中断，请核对当前展示谱面后重试。';
    } finally { busy.value = false; }
  };
  return { snapshot, connection, busy, error, select };
}
