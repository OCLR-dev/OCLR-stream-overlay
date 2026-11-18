import { computed, onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue';

type StreamStatus = 'off' | 'active' | 'starting' | 'stopping' | 'reconnecting';
type RecordStatus = 'off' | 'active' | 'starting' | 'stopping' | 'paused';
interface ProgramFrame { program: string; programRevision: number; image: string | null }

interface ObsStatus {
  enabled: boolean; port: number; hasPassword: boolean; phase: 'off' | 'connecting' | 'offline' | 'ready';
  collection: string | null; program: string | null; programRevision: number;
  stream: StreamStatus | null; record: RecordStatus | null;
  recordingError: { matchId: string; message: string } | null; scenes: string[]; regular: string; ex: string;
  follow: boolean; target: 'regular' | 'ex' | null; managed: boolean; lineup: string[]; error: string;
  streamChat: 'off' | 'pending' | 'configured';
  showcase: boolean;
  showcaseTransition?: { configured: boolean; artwork?: boolean; active: boolean; covered: boolean | null;
    phase: 'covered' | 'playing' | 'results' | 'manual'; error: string };
  windows: { value: string; label: string }[];
  rows: { slot: string; input: string; value: string; status: string }[];
}

export function useObsControl() {
  const state = shallowRef<ObsStatus | null>(null);
  const pending = ref('');
  const error = ref('');
  const markError = ref('');
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
    const actionError = action === 'mark-recording' ? markError : error;
    actionError.value = '';
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
      actionError.value = err instanceof Error && /[\u3400-\u9fff]/.test(err.message) ? err.message : '本机服务未响应，请核对 OBS 后重试。';
      return false;
    } finally { generation++; pending.value = ''; }
  }
  async function readProgram(signal: AbortSignal): Promise<ProgramFrame | null> {
    const revision = generation;
    const response = await fetch('/api/obs/program', { signal });
    if (!response.ok) throw new Error();
    const frame: ProgramFrame | null = await response.json();
    const current = state.value;
    if (signal.aborted || !alive || revision !== generation || current?.phase !== 'ready' ||
        !frame || frame.programRevision < current.programRevision) return null;
    if (frame.programRevision !== current.programRevision) {
      generation++;
      state.value = { ...current, program: frame.program, programRevision: frame.programRevision };
    }
    return frame;
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
  return reactive({ state, pending, error, markError, status, canReturn, measurement, unreachable, act, readProgram });
}
export type ObsControl = ReturnType<typeof useObsControl>;
