import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import type { Team } from './model';

export function commandErrorMessage(message: unknown) {
  if (message === '未知会话命令') return '本机服务尚未更新，请重启服务后刷新页面。比赛记录会保留。';
  return typeof message === 'string' && message ? message : '操作未应用';
}

export interface PoolEntry { id: string; beatmapId: number; mod: string; label: string; title: string; artist: string; difficulty: string }
export interface MatchTeam { id: string | null; name: string; roster: { name: string; osuId: number | null }[] }
export interface BpAction { id: string; kind: 'ban' | 'pick'; team: Team; slot: number | null }
export interface Round { id: string; replayOf?: string; entryId: string; pickedBy: Team; status: 'prepared' | 'playing' | 'ranking' | 'recorded' | 'void'; winner: Team | null; runId: string | null; source: string; resultSource?: string; autoProtected?: boolean; finalScore: { a: number | null; b: number | null } | null; exTeam: Team | null }
export interface PoolMark { entryId: string; status: 'open' | 'banned' | 'picked'; team: Team | null }
export interface Session {
  schema: number; id: string; version: number;
  match: { title: string; edition: string | null; fixtureId: string | null; poolId: string | null; provenance: string;
    stage: 'group' | 'elimination' | 'final'; mode: '3v3' | '4v4'; source: '4x3' | '16x9'; teams: Record<Team, MatchTeam> };
  pool: PoolEntry[]; poolMarks?: PoolMark[]; phase: 'arrival' | 'roll' | 'bp' | 'playing' | 'winner'; scene: string; returnScene: string | null; locked: boolean;
  arrived: Record<Team, boolean>; ready: Record<Team, boolean>;
  roll: { a: number | null; b: number | null; winner: Team | null; pickFirst: Team | null; banFirst: Team | null };
  action: BpAction | null; queue: BpAction[]; planVerification?: string | null; bans: Record<Team, [string | null, string | null]>;
  auto: { bp: boolean; scenes: boolean; profile: string; left: string; right: string; mapDebounceMs: number; rankingDebounceMs: number };
  rounds: Round[]; currentRoundId: string | null; winner: Team | null;
  incident?: { kind: 'prestart-abort' | 'abort' | 'player-disconnect' | 'spectator' | 'unverified'; roundId: string; reason: string; source: string; at: string } | null;
  series: Record<Team, number>; seriesAdjustment: Record<Team, number>;
  ex: { team: Team | null; remaining: Record<Team, number> }; pauseType: 'technical' | 'tactical';
  history: { id: string; at: string; version: number; message: string; source: string }[]; canUndo: boolean;
}
export interface Envelope {
  session: Session; persistence: string;
  live: {
    note: string;
    oclr: { status: string; updatedAt: string | null; error: string | null };
    tosu: { status: string; updatedAt: string | null; data: null | {
      beatmap: { id: number | null; title: string | null;
        time: { current: number | null; firstObject: number | null; lastObject: number | null };
        stats: null | { stars: { total: number | null }; cs: { converted: number | null };
          ar: { converted: number | null }; od: { converted: number | null }; bpm: { common: number | null } } };
      tourney: null | { teams: { left: string | null; right: string | null }; ipcState: number | null;
        totalScore: { left: number | null; right: number | null }; chat: { name?: string; message?: string; timestamp?: string }[] }
    } };
  };
  catalog: null | { edition: string | null; kind?: string; warnings?: string[]; capturedOn?: string | null; teams: MatchTeam[]; pools: { id: string; name: string; entries: PoolEntry[] }[];
    fixtures: { id: string; label: string; roundName: string; home: { team?: { id: string } | null }; away: { team?: { id: string } | null }; pool: { id: string } | null }[] };
}

export function useSession() {
  const snapshot = shallowRef<Envelope | null>(null);
  const connection = ref('connecting');
  const error = ref('');
  const busy = ref(false);
  const presentationEpoch = ref(0);
  let events: EventSource | undefined;
  let lastReceived = 0;
  let watchdog: ReturnType<typeof setInterval>;
  let disposed = false;
  // The console preview shares its parent's existing SSE snapshot. Opening extra
  // consoles must not double long-lived HTTP connections and starve commands.
  let embeddedPreview = false;
  try { embeddedPreview = window.parent !== window && window.parent.location.origin === location.origin && window.parent.location.pathname === '/control'; } catch { /* Standalone output owns its SSE. */ }
  const apply = (value: Envelope) => {
    if (disposed) return;
    if (snapshot.value && value.session.version < snapshot.value.session.version) return;
    if (connection.value !== 'synced' || snapshot.value?.session.id !== value.session.id) presentationEpoch.value += 1;
    snapshot.value = value; lastReceived = Date.now(); connection.value = 'synced';
  };
  const previewMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'oclr-session-preview') return;
    if (event.data.connection === 'synced' && event.data.snapshot?.session) apply(event.data.snapshot);
    else connection.value = 'disconnected';
  };
  onMounted(() => {
    document.body.dataset.sessionTransport = embeddedPreview ? 'parent-preview' : 'sse';
    watchdog = setInterval(() => {
      if (Date.now() - lastReceived > 20000) connection.value = 'disconnected';
    }, 2000);
    if (embeddedPreview) {
      window.addEventListener('message', previewMessage);
      window.parent.postMessage({ type: 'oclr-preview-ready' }, location.origin);
      return;
    }
    events = new EventSource('/api/session/events');
    events.addEventListener('snapshot', event => {
      try { apply(JSON.parse((event as MessageEvent).data)); } catch { connection.value = 'error'; }
    });
    events.addEventListener('heartbeat', () => { lastReceived = Date.now(); connection.value = 'synced'; });
    events.onerror = () => { presentationEpoch.value += 1; connection.value = 'disconnected'; };
  });
  onUnmounted(() => { disposed = true; events?.close(); clearInterval(watchdog); window.removeEventListener('message', previewMessage); });

  const command = async (type: string, payload: unknown = {}) => {
    if (embeddedPreview || busy.value || !snapshot.value || connection.value !== 'synced') return false;
    busy.value = true; error.value = '';
    // One ID for this attempt; a lost response is never silently retried as a new action.
    const request = { id: crypto.randomUUID(), version: snapshot.value.session.version, type, payload };
    try {
      const response = await fetch('/api/session/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(60000) });
      const value = await response.json();
      if (value.snapshot) apply(value.snapshot);
      if (!response.ok) throw new Error(commandErrorMessage(value.error?.message));
      apply(value); return true;
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '请求失败，请核对操作记录后重试';
      return false;
    } finally { busy.value = false; }
  };
  return { snapshot, connection, error, busy, command, presentationEpoch };
}
