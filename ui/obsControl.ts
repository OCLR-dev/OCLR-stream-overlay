import { computed, onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue';

interface ObsStatus {
  enabled: boolean; port: number; hasPassword: boolean; phase: 'off' | 'connecting' | 'offline' | 'ready';
  collection: string | null; program: string | null; scenes: string[]; regular: string; ex: string;
  follow: boolean; target: 'regular' | 'ex' | null; managed: boolean; lineup: string[]; error: string;
  streamChat: 'off' | 'pending' | 'configured';
  windows: { value: string; label: string }[];
  rows: { slot: string; input: string; value: string; status: string }[];
}

export function useObsControl() {
  const state = shallowRef<ObsStatus | null>(null);
  const pending = ref('');
  const error = ref('');
  const unreachable = ref(false);
  const measurement = ref('');
  let generation = 0;
  let alive = true;
  let timer: ReturnType<typeof setTimeout>;
  async function refresh() {
    const revision = generation;
    try {
      if (pending.value) return;
      const response = await fetch('/api/obs', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (alive && revision === generation) { state.value = result; unreachable.value = false; }
    } catch {
      if (alive && revision === generation) unreachable.value = true;
    } finally {
      if (alive) timer = setTimeout(refresh, state.value?.enabled ? 1500 : 6000);
    }
  }
  async function act(action: string, fields: Record<string, unknown> = {}) {
    if (pending.value) return false;
    generation++;
    pending.value = action;
    error.value = '';
    try {
      const response = await fetch('/api/obs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, collection: state.value?.collection, ...fields }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || '操作未完成，请重试。');
      if (action === 'measure') measurement.value = JSON.stringify(result.measurements, null, 2);
      else measurement.value = '';
      state.value = result;
      unreachable.value = false;
      return true;
    } catch (err) {
      error.value = err instanceof Error && /[\u3400-\u9fff]/.test(err.message) ? err.message : '本机服务未响应，请核对 OBS 后重试。';
      return false;
    } finally { generation++; pending.value = ''; }
  }
  const status = computed(() => {
    const s = state.value;
    if (unreachable.value) return '暂时无法读取 OBS 播出状态';
    if (s?.phase === 'ready') return s.program ? `正在播出：${s.program}` : '等待读取 OBS 播出场景';
    if (s?.phase === 'offline') return 'OBS 已断开，正在重连';
    if (s?.phase === 'connecting') return '正在连接本机 OBS';
    return 'OBS 未连接';
  });
  const canReturn = computed(() => {
    const s = state.value;
    return !unreachable.value && s?.phase === 'ready' && !!s.target && !!s.regular && !!s.ex &&
      s.scenes.includes(s.regular) && s.scenes.includes(s.ex) && s.program !== s[s.target];
  });
  onMounted(refresh);
  onUnmounted(() => { alive = false; clearTimeout(timer); });
  return reactive({ state, pending, error, status, canReturn, measurement, act });
}
export type ObsControl = ReturnType<typeof useObsControl>;
