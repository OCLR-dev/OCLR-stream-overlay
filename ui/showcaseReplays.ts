import { onMounted, onUnmounted, ref, shallowRef } from 'vue';

interface ReplayOption {
  id: string;
  filename: string;
  playerName: string;
  mods: number;
  local?: boolean;
}

interface ReplayList {
  revision: number;
  poolToken: string;
  generation: number;
  nextSlot: string | null;
  gate: 'off' | 'cover' | 'ready';
  status: 'local' | 'unread' | 'refreshing' | 'ready' | 'stale' | 'error';
  message: string;
  playback: { phase: 'idle' | 'loading' | 'waiting' | 'playing' | 'completed' | 'failed'; slotId: string | null; message: string };
  rows: { slotId: string; options: ReplayOption[]; selectedId: string | null }[];
}

const mods = ['NF', 'EZ', 'TD', 'HD', 'HR', 'SD', 'DT', 'RX', 'HT', 'NC', 'FL', 'AT', 'SO', 'AP', 'PF',
  '4K', '5K', '6K', '7K', '8K', 'FI', 'RD', 'CN', 'TP', '9K', 'CO', '1K', '3K', '2K', 'V2', 'MR'];
export function replayLabel(replay: ReplayOption) {
  const names = mods.filter((_, i) => Math.floor(replay.mods / 2 ** i) % 2);
  const visible = names.filter(name => !(name === 'DT' && names.includes('NC')) && !(name === 'SD' && names.includes('PF')));
  const label = visible.join('') || (replay.mods ? String(replay.mods) : 'NM');
  return [replay.filename, replay.playerName, label, replay.local ? '本地' : ''].filter(Boolean).join(' · ');
}

export function useShowcaseReplays(enabled: boolean) {
  const list = shallowRef<ReplayList | null>(null);
  const busy = ref(false);
  const online = ref(false);
  const error = ref('');
  const root = '/api/showcase/replays';
  let events: EventSource | undefined;
  const apply = (value: ReplayList) => {
    if (list.value && value.revision < list.value.revision && online.value) return;
    list.value = value;
    online.value = true;
  };
  onMounted(() => {
    if (!enabled) return;
    events = new EventSource(root + '/events');
    events.addEventListener('snapshot', event => { apply(JSON.parse((event as MessageEvent).data)); });
    events.onerror = () => { online.value = false; };
  });
  onUnmounted(() => events?.close());
  async function replayCommand(action: string, fields: Record<string, string | number | null> = {}, file?: File) {
    const poolToken = list.value?.poolToken;
    if (!poolToken || !online.value || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      const url = file ? root + '/file?' + new URLSearchParams({ poolToken, slotId: String(fields.slotId), filename: file.name }) : root;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': file ? 'application/octet-stream' : 'application/json' },
        body: file || JSON.stringify({ poolToken, action, ...fields }),
        signal: AbortSignal.timeout(20000),
      });
      const value = await response.json();
      if (value.snapshot) apply(value.snapshot);
      if (!response.ok) { error.value = value.error?.message || '回放操作未完成，请重试。'; return; }
      apply(value);
    } catch { error.value = '回放操作连接中断，请检查清单状态后重试。'; }
    finally { busy.value = false; }
  }
  return { list, busy, online, error, replayCommand };
}
