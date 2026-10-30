<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useSession, type BpAction, type PoolEntry } from '../session';
import { sceneLabels, type Scene, type Team } from '../model';
import ControlSelect from './ControlSelect.vue';
import { poolDisplay } from '../poolDisplay';
import { useMotionReady } from '../motion';
import '../control.css';

const { snapshot, connection, error, busy, command, presentationEpoch } = useSession();
const motionScope = computed(() => `${snapshot.value?.session.id}:${presentationEpoch.value}:${connection.value}`);
const motionReady = useMotionReady(motionScope);
const preview = ref<HTMLIFrameElement>();
let previewHeartbeat: ReturnType<typeof setInterval>;
const sharePreview = () => preview.value?.contentWindow?.postMessage({ type: 'oclr-session-preview', snapshot: snapshot.value, connection: connection.value }, location.origin);
const previewReady = (event: MessageEvent) => {
  if (event.origin === location.origin && event.source === preview.value?.contentWindow && event.data?.type === 'oclr-preview-ready') sharePreview();
};
watch([snapshot, connection], sharePreview, { flush: 'post' });
const s = computed(() => snapshot.value?.session);
const live = computed(() => snapshot.value?.live);
const catalog = computed(() => snapshot.value?.catalog);
const disabled = computed(() => busy.value || connection.value !== 'synced');
const round = computed(() => s.value?.rounds.find(r => r.id === s.value?.currentRoundId));
const entry = (id?: string | null) => s.value?.pool.find(e => e.id === id);
const names = computed(() => ({ a: s.value?.match.teams.a.name || '左队', b: s.value?.match.teams.b.name || '右队' }));
const series = computed(() => s.value?.series || { a: 0, b: 0 });
const target = computed(() => s.value?.match.stage === 'final' ? 7 : 6);
const recordingPrevious = computed(() => !!resultRound.value && resultRound.value !== s.value?.currentRoundId);
const panel = computed(() => s.value?.scene === 'map-result' ? 'playing' : s.value?.scene || 'waiting');
const scorePanel = computed(() => panel.value === 'playing');
const panelHeading = computed(() => ({ waiting: '到场与就绪', roll: 'Roll 点数与先手', mappool: '图池 Ban / Pick', playing: '比分与赛果', victory: '全场胜方', pause: '暂停管理' }[panel.value]));
const scenes = [['waiting', '等待'], ['roll', 'Roll / 先手'], ['mappool', '图池 / BP'], ['playing', 'Playing'], ['map-result', '单图结算'], ['victory', 'Winner']] as const;
const actionText = (action?: BpAction | null) => action ? `${names.value[action.team]} · ${action.kind === 'ban' ? `第${(action.slot ?? 0) === 0 ? '一' : '二'}次 Ban` : action.ordinal ? `第 ${action.ordinal} 次 Pick` : 'Pick'}` : '等待明确动作';
const bpCurrent = computed(() => s.value?.bp?.waiting || (s.value?.action ? actionText(s.value.action) : !s.value?.roll.banFirst || !s.value?.roll.pickFirst ? '等待分别选择先 Ban 与先 Pick' : '保留已有 BP，请在手动调整中核对当前动作'));
const canCompleteBp = computed(() => !!s.value?.bp?.canApply && !!poolSelection.value);
const canReplaceBp = computed(() => !!s.value?.bp?.canReplace && !!poolSelection.value);
const form = reactive({ title: 'OCLR S11', a: '', b: '', rosterA: '', rosterB: '', pool: '', mode: '4v4', source: '4x3' });
const rollForm = reactive({ a: '', b: '', winner: '', pickFirst: '', banFirst: '' });
const autoForm = reactive({ bp: true, scenes: true, results: true, profile: 'unverified', left: '', right: '' });
const actionForm = reactive({ kind: '', team: '', slot: -1 });
const mapForm = reactive({ entryId: '', pickedBy: '' });
const poolEntryId = ref('');
const poolSelection = computed(() => s.value?.pool.find(e => e.id === poolEntryId.value));
const selectedMark = computed(() => s.value && poolSelection.value ? poolDisplay(s.value, poolEntryId.value) : null);
const prepareForm = reactive({ entryId: '', pickedBy: '' });
const tbForm = reactive({ entryId: '', pickedBy: '' });
const selection = reactive({ edition: 's11', fixtureId: '', poolId: '', leftTeamId: '', rightTeamId: '' });
const resultRound = ref('');
const reason = ref('');
const localError = ref('');
const settings = ref(false);
const initializeDialog = ref<HTMLDialogElement>();
const initializeError = ref('');
let initializeMatchId = '';
const settingMessages = reactive<Record<string, string>>({});
const dirtySettings = new Set<string>();
const settingQueue = new Map<string, number>();
const settingVersions = new Map<string, number>();
const settingContexts = new Map<string, string | null>();
const settingTimers = new Map<string, ReturnType<typeof setTimeout>>();
let drainingSettings = false;
const diagnostics = ref(false);
const adjustments = ref(false);
const incidentOpen = ref(false);
const feedback = ref('');
const feedbackKind = ref('success');
const exForm = reactive({ a: 2, b: 2 });
const canEnableEx = computed(() => round.value?.status === 'prepared' && !!entry(round.value.entryId) && entry(round.value.entryId)?.mod !== 'TB');
const exHint = computed(() => entry(round.value?.entryId)?.mod === 'TB' ? '本图为 TB，不能开启 EX。'
  : canEnableEx.value ? '由直播员手动设置；开启／关闭不会自动扣次数。'
  : !round.value || ['recorded', 'void'].includes(round.value.status) ? '先准备本局谱面，再开启 EX。'
  : '本局已开打；可关闭 EX，不能更换开启方。');
const exUnavailable = (team: Team) => s.value?.ex.team !== team && (!canEnableEx.value || !s.value?.ex.remaining[team]);
const correctedScore = reactive({ a: 0, b: 0 });
const incidentReason = ref('');
const incidentLabels = { 'prestart-abort': '开打前取消启动 / 卡住', abort: '已开打后 abort', 'player-disconnect': '有人尚未结束 · 等待核对', spectator: '观战故障 / Panic', unverified: '观战信号异常 · 原因待核对' };
const plan = reactive({ rows: [] as { team: Team | ''; kind: 'ban' | 'pick' | ''; slot: number }[], verifiedBy: '' });
const canHandleRound = computed(() => !!round.value && ['prepared', 'playing', 'ranking'].includes(round.value.status));
const canContinueRound = computed(() => round.value?.status === 'prepared' || (round.value?.status === 'playing' && live.value?.tosu.status === 'live' &&
  live.value.tosu.data?.tourney?.ipcState === 3 && live.value.tosu.data?.beatmap.id === entry(round.value.entryId)?.beatmapId));
const roundStatus = { prepared: '已选图 · 尚未开打', playing: '进行中', ranking: '结算待记录', recorded: '已计胜', void: '已作废' };
let initialized = '';
let matchKey = '';
let rollKey = '';
let autoKey = '';
let exKey = '';
let actionKey = '';
let planKey = '';
let mapKey = '';
let incidentRoundKey = '';
let incidentKey = '';
watch(s, value => {
  if (!value) return;
  const nextIncidentRoundKey = `${value.id}:${value.currentRoundId}`;
  if (incidentRoundKey !== nextIncidentRoundKey) { incidentRoundKey = nextIncidentRoundKey; incidentReason.value = ''; incidentOpen.value = false; }
  const nextIncidentKey = value.incident?.at || '';
  if (incidentKey !== nextIncidentKey) {
    incidentKey = nextIncidentKey;
    if (!value.incident || value.incident.source === 'tosu') incidentReason.value = '';
    if (!value.incident) incidentOpen.value = false;
  }
  if (initialized !== value.id) {
    initialized = value.id;
    feedback.value = ''; feedbackKind.value = 'success'; localError.value = '';
    for (const timer of settingTimers.values()) clearTimeout(timer);
    settingTimers.clear(); settingQueue.clear(); dirtySettings.clear(); settingVersions.clear();
    for (const key of Object.keys(settingMessages)) delete settingMessages[key];
    plan.rows = []; plan.verifiedBy = ''; poolEntryId.value = ''; prepareForm.entryId = ''; prepareForm.pickedBy = '';
    tbForm.entryId = ''; tbForm.pickedBy = '';
    Object.assign(mapForm, { entryId: '', pickedBy: '' });
    settingContexts.clear();
    Object.assign(selection, { edition: catalog.value?.edition || value.match.edition || 's11', fixtureId: '', poolId: '', leftTeamId: '', rightTeamId: '' });
    resultRound.value = ''; reason.value = ''; incidentReason.value = ''; adjustments.value = false;
    if (!value.pool.length) settings.value = true;
  }
  const nextMatchKey = JSON.stringify([value.id, value.match.title, value.match.teams, value.match.mode, value.match.source, value.pool]);
  if (nextMatchKey !== matchKey) {
    matchKey = nextMatchKey;
    const fields = { title: value.match.title, a: value.match.teams.a.name, b: value.match.teams.b.name,
      rosterA: value.match.teams.a.roster.map(p => p.name).join('\n'), rosterB: value.match.teams.b.roster.map(p => p.name).join('\n'),
      pool: value.pool.map(e => `${e.label} ${e.beatmapId} ${e.title}`).join('\n'), mode: value.match.mode, source: value.match.source };
    for (const [key, field] of Object.entries(fields)) {
      if (!dirtySettings.has(key)) (form as Record<string, string>)[key] = field;
    }
  }
  const nextRollKey = JSON.stringify([value.id, value.roll]);
  if (rollKey !== nextRollKey) { rollKey = nextRollKey; if (!dirtySettings.has('roll')) Object.assign(rollForm, Object.fromEntries(Object.entries(value.roll).map(([k, v]) => [k, v ?? '']))); }
  const nextAutoKey = JSON.stringify([value.id, value.auto]);
  if (autoKey !== nextAutoKey) { autoKey = nextAutoKey; if (!dirtySettings.has('auto')) Object.assign(autoForm, value.auto); }
  const nextExKey = JSON.stringify([value.id, value.ex]);
  if (exKey !== nextExKey) {
    exKey = nextExKey;
    for (const team of ['a', 'b'] as const) if (!dirtySettings.has(`ex-${team}`)) exForm[team] = value.ex.remaining[team];
  }
  const current = value.rounds.find(r => r.id === value.currentRoundId);
  const nextMapKey = JSON.stringify([value.id, current?.id, current?.entryId, current?.pickedBy, current?.status]);
  if (mapKey !== nextMapKey) {
    mapKey = nextMapKey;
    if (!dirtySettings.has('round')) Object.assign(mapForm, { entryId: current?.entryId || '', pickedBy: current?.pickedBy || '' });
    if (!dirtySettings.has('prepare')) Object.assign(prepareForm, current?.status === 'prepared' ? { entryId: current.entryId, pickedBy: current.pickedBy } : { entryId: '', pickedBy: '' });
  }
  const nextActionKey = JSON.stringify([value.id, value.action, value.queue]);
  if (actionKey !== nextActionKey) {
    actionKey = nextActionKey;
    if (!dirtySettings.has('action')) Object.assign(actionForm, value.action ? { kind: value.action.kind, team: value.action.team, slot: value.action.slot ?? -1 } : { kind: '', team: '', slot: -1 });
  }
  const nextPlanKey = JSON.stringify([value.id, value.queue, value.planVerification]);
  if (planKey !== nextPlanKey) {
    planKey = nextPlanKey;
    if (!dirtySettings.has('plan')) {
      plan.rows = value.queue.map(a => ({ team: a.team, kind: a.kind, slot: a.slot ?? -1 }));
      plan.verifiedBy = value.planVerification || '';
    }
  }
  for (const team of ['a', 'b'] as const) {
    if (!dirtySettings.has(`series-${team}`)) correctedScore[team] = value.series[team];
  }
  if (!resultRound.value || !value.rounds.some(r => r.id === resultRound.value && ['playing', 'ranking'].includes(r.status))) {
    resultRound.value = value.rounds.find(r => ['playing', 'ranking'].includes(r.status))?.id || '';
  }
});
const run = async (type: string, payload: unknown = {}) => {
  localError.value = '';
  const ok = await command(type, payload);
  if (ok) {
    const messages: Record<string, string> = {
      auto: '自动化设置已同步，条件有效时自动跟随新的比赛事件。',
      display: `已切到${sceneLabels[s.value?.scene as Scene]}，比赛进度继续跟随；${s.value?.auto.scenes ? '下一有效比赛事件自动接回画面。' : '自动选画面已关闭，保持人工画面。'}`,
      pause: '已展示暂停画面，比赛记录保留。准备好后点击返回原画面。',
      resume: '已结束暂停，自动建立安全基线；保留比赛记录，不补记暂停期间的赛果。',
      start: '本局已标记开打，正在播出比赛画面。正常结束后自动结算，异常时可先等待。',
      'set-action': '已设置当前队伍与动作。点选谱面，或等待裁判在房间换图。',
      'next-match': '已初始化，请重新设置比赛。误操作可撤销上一项。',
      undo: `已撤销上一项。当前系列比分 ${series.value.a} : ${series.value.b}，请核对当前图后继续。`,
    };
    feedback.value = messages[type] || s.value?.history.at(-1)?.message || '操作已同步';
    feedbackKind.value = type === 'undo' ? 'undo' : 'success';
  }
  return ok;
};
function openInitialize() {
  if (!s.value || disabled.value) return;
  initializeMatchId = s.value.id;
  initializeError.value = '';
  initializeDialog.value?.showModal();
}
async function initializeMatch() {
  if (s.value?.id !== initializeMatchId) {
    initializeError.value = '比赛已切换，请关闭后重新操作。';
    return;
  }
  if (await run('next-match')) {
    initializeDialog.value?.close();
    settings.value = true; diagnostics.value = false;
  } else initializeError.value = error.value || '初始化未完成，请稍后重试。';
}
async function changeStage(stage: string | number) {
  await run('set-stage', { stage });
}
function adjustExCount(team: Team, delta: number) {
  if (!s.value) return;
  const remaining = { ...s.value.ex.remaining, [team]: s.value.ex.remaining[team] + delta };
  return run('ex', { team: s.value.ex.team, remaining });
}
function setExTeam(team: Team | null) {
  if (!s.value || disabled.value || team === s.value.ex.team || (team && exUnavailable(team))) return;
  return run('ex', { team, remaining: { ...s.value.ex.remaining } });
}

function parsePool(): PoolEntry[] {
  return form.pool.split('\n').filter(line => line.trim()).map((line, index) => {
    const match = line.trim().match(/^((NM|HD|HR|DT|FM|TB)\d*)\s+(\d+)(?:\s+(.+))?$/i);
    if (!match) throw new Error(`图池第 ${index + 1} 行：使用「标签 谱面ID 标题」格式`);
    const label = match[1]!.toUpperCase();
    const existing = s.value?.pool.find(e => e.label === label) || s.value?.pool.find(e => e.beatmapId === Number(match[3]));
    return { id: existing?.id || label, label, mod: match[2]!.toUpperCase(), beatmapId: Number(match[3]), title: match[4] || '', artist: existing?.artist || '', difficulty: existing?.difficulty || '',
      ...(existing?.beatmapId === Number(match[3]) && existing.setId ? { setId: existing.setId } : {}) };
  });
}

function fixtureSelected() {
  const fixture = catalog.value?.fixtures.find(f => f.id === selection.fixtureId);
  selection.poolId = fixture?.pool?.id || '';
  selection.leftTeamId = fixture?.home?.team?.id || '';
  selection.rightTeamId = fixture?.away?.team?.id || '';
  scheduleSetting('import', true);
}
function scheduleSetting(key: string, immediate = false) {
  dirtySettings.add(key);
  if (key === 'round' || key === 'prepare') settingContexts.set(key, s.value?.currentRoundId ?? null);
  settingMessages[key] = '等待同步…';
  const version = (settingVersions.get(key) || 0) + 1;
  settingVersions.set(key, version);
  clearTimeout(settingTimers.get(key));
  const enqueue = () => { settingTimers.delete(key); settingQueue.set(key, version); void drainSettings(); };
  if (immediate) enqueue();
  else settingTimers.set(key, setTimeout(enqueue, 450));
}
async function drainSettings() {
  if (drainingSettings || busy.value || connection.value !== 'synced') return;
  drainingSettings = true;
  try {
    while (settingQueue.size && !busy.value && connection.value === 'synced') {
      const [key, version] = settingQueue.entries().next().value!;
      settingQueue.delete(key);
      if (settingVersions.get(key) !== version) continue;
      const sessionId = s.value?.id;
      const scoreTeam = key === 'series-a' ? 'a' : key === 'series-b' ? 'b' : null;
      settingMessages[key] = '正在同步…';
      try {
        let type = 'setting';
        let payload: unknown;
        if (scoreTeam) {
          const value = correctedScore[scoreTeam];
          if (!Number.isInteger(value) || value < 0 || value > target.value) throw new Error(`请输入 0 到 ${target.value} 之间的整数，空白不会记为 0`);
          if (value === s.value?.series[scoreTeam]) {
            dirtySettings.delete(key); settingMessages[key] = '已同步'; continue;
          }
          type = 'set-series'; payload = seriesPayload(scoreTeam, value);
        } else if (key === 'auto') {
          type = 'auto'; payload = { ...autoForm };
        } else if (key === 'round' || key === 'prepare') {
          const value = key === 'round' ? mapForm : prepareForm;
          if (!value.entryId || !value.pickedBy) throw new Error('请选择谱面与选图队伍，完整后自动生效');
          if (settingContexts.get(key) !== (s.value?.currentRoundId ?? null)) throw new Error('本局已切换，请在最新轮次重新修改');
          type = key === 'round' ? 'adjust-round' : 'prepare-round';
          payload = { ...value, ifCurrentRoundId: settingContexts.get(key) };
        } else if (key === 'action') {
          if (!actionForm.team || !actionForm.kind || (actionForm.kind === 'ban' && ![0, 1].includes(actionForm.slot))) throw new Error('请选择队伍、动作及 Ban 槽，完整后自动生效');
          type = 'set-action'; payload = { action: { ...actionForm } };
        } else if (key.startsWith('ex-')) {
          const team = key === 'ex-a' ? 'a' : key === 'ex-b' ? 'b' : null;
          if (team && (!Number.isInteger(exForm[team]) || exForm[team] < 0 || exForm[team] > 2)) throw new Error('请输入 0 到 2 之间的整数，空白不会记为 0');
          type = 'ex'; payload = { team: s.value!.ex.team,
            remaining: { ...s.value!.ex.remaining, ...(team ? { [team]: exForm[team] } : {}) } };
        } else if (key === 'roll') {
          type = 'set-roll';
          payload = { a: rollForm.a === '' ? null : Number(rollForm.a), b: rollForm.b === '' ? null : Number(rollForm.b),
            winner: rollForm.winner || null, pickFirst: rollForm.pickFirst || null, banFirst: rollForm.banFirst || null };
        } else if (key === 'plan') {
          if (plan.rows.some(row => !row.team || !row.kind || (row.kind === 'ban' && ![0, 1].includes(row.slot)))) throw new Error('请选择每项队伍、动作及 Ban 槽，完整后自动生效');
          type = 'set-plan'; payload = { queue: plan.rows.map(row => ({ ...row })), verifiedBy: plan.verifiedBy };
        } else if (key === 'edition') {
          selection.fixtureId = ''; selection.poolId = ''; selection.leftTeamId = ''; selection.rightTeamId = '';
          type = 'load-edition'; payload = { edition: selection.edition };
        } else if (key === 'import') {
          if (!selection.poolId || !selection.leftTeamId || !selection.rightTeamId) throw new Error('请选择完整对阵与图池；选择完成后自动生效');
          type = 'import-match'; payload = { ...selection, title: form.title, stage: s.value?.match.stage, mode: form.mode, source: form.source };
        } else if (key === 'a' || key === 'b') payload = { field: 'team-name', team: key, value: form[key] };
        else if (key === 'rosterA' || key === 'rosterB') {
          const team = key === 'rosterA' ? 'a' : 'b';
          const roster = form[key].split('\n').map(name => name.trim()).filter(Boolean).map(name => ({ name, osuId: s.value?.match.teams[team].roster.find(p => p.name === name)?.osuId ?? null }));
          payload = { field: 'roster', team, value: roster };
        } else payload = { field: key, value: key === 'pool' ? parsePool() : form[key as keyof typeof form] };
        let ok = await run(type, payload);
        // A confirmed version conflict applied nothing. Retry this idempotent setting once against the returned snapshot.
        if (!ok && error.value.startsWith('会话已被其他操作更新') && s.value?.id === sessionId && settingVersions.get(key) === version) {
          if (scoreTeam) payload = seriesPayload(scoreTeam, correctedScore[scoreTeam]);
          if (key === 'ex-a' || key === 'ex-b') { const team = key === 'ex-a' ? 'a' : 'b'; payload = { team: s.value!.ex.team, remaining: { ...s.value!.ex.remaining, [team]: exForm[team] } }; }
          ok = await run(type, payload);
        }
        if (s.value?.id === sessionId && settingVersions.get(key) === version) {
          settingMessages[key] = ok ? '已同步' : error.value || '未同步，请检查后重新修改';
          if (ok) {
            dirtySettings.delete(key);
            if (scoreTeam && s.value) correctedScore[scoreTeam] = s.value.series[scoreTeam];
            if (key === 'auto' && s.value) Object.assign(autoForm, s.value.auto);
          }
        }
      } catch (e) { if (settingVersions.get(key) === version) settingMessages[key] = (e as Error).message; }
    }
  } finally { drainingSettings = false; }
}
watch([busy, connection], () => { void drainSettings(); });

function recordResult(winner: Team) {
  return run('record-result', { roundId: resultRound.value, winner, keepDisplay: true,
    reviewReason: s.value?.incident?.roundId === resultRound.value ? incidentNote('直播员已核对实际成绩，人工记录胜方') : undefined });
}
const markPool = (status: 'open' | 'banned' | 'picked', team: Team | null) => run('map-mark', { entryId: poolEntryId.value, status, team });
const note = (fallback: string) => reason.value.trim() || fallback;
const incidentNote = (fallback: string) => incidentReason.value.trim() || fallback;
const hold = (kind: string, message: string) => run(round.value?.status === 'recorded' ? 'wait-result' : 'incident', { kind, reason: incidentNote(message) });
const showIncidents = () => {
  settings.value = false; diagnostics.value = false; incidentOpen.value = true;
  requestAnimationFrame(() => document.getElementById('incident-panel')?.scrollIntoView({ behavior: 'instant', block: 'start' }));
};
const showManualResult = async () => {
  settings.value = false; diagnostics.value = false;
  if (!scorePanel.value) await display('playing');
  requestAnimationFrame(() => document.getElementById('manual-result')?.scrollIntoView({ behavior: 'instant', block: 'start' }));
};
const showAdjustments = () => {
  settings.value = false; diagnostics.value = false; adjustments.value = true;
  requestAnimationFrame(() => {
    const element = document.getElementById('manual-adjustments');
    element?.scrollIntoView({ behavior: 'instant', block: 'start' });
    element?.querySelector('summary')?.focus({ preventScroll: true });
  });
};
function poolState(id: string) {
  if (!s.value) return '';
  const mark = poolDisplay(s.value, id);
  return mark.team && mark.status !== 'open' ? `${names.value[mark.team]} ${mark.status === 'banned' ? 'Ban' : mark.status === 'used' ? '已打' : 'Pick'}` : '';
}
const nextStep = computed(() => {
  if (connection.value !== 'synced') return '控制台连接中断，正在重新连接。恢复后核对最近操作再继续。';
  if (panel.value === 'waiting') return '在这里管理双方到场与就绪状态。';
  if (panel.value === 'roll') return '分别选择先 Ban 与先 Pick，新比赛自动建立顺序；已发生的 BP、当前局和比分保留。';
  if (panel.value === 'mappool') return '正常 BP 自动跟随裁判换图。漏记时点选谱面并完成当前真实动作；播出标记仍可独立修改。';
  if (panel.value === 'pause') return '调整暂停类型或返回原画面，保留比赛记录。';
  if (panel.value === 'victory') return '核对最终系列比分，选择胜方展示，或准备下一场。';
  if (s.value?.incident) return '本图自动加分已暂停。请核对实际赛果，或使用现场处理继续等待 / 重赛。';
  return '正常成绩自动计胜；需要时在这里人工记胜、撤回或直接校正系列比分。';
});
const gameStatus = computed(() => live.value?.sources?.tosu === 'simulated' && live.value?.tosu.status === 'live' ? 'tosu 模拟数据已连接' : ({ live: '游戏数据已连接', stale: '游戏数据已过期', 'invalid-data': '游戏数据格式错误', error: '游戏数据连接出错', disconnected: '游戏数据连接中断', connecting: '正在连接游戏数据', stopped: '游戏数据已停止', idle: '尚未接入游戏数据' }[live.value?.tosu.status || 'idle'] || '等待游戏数据'));
const latestResult = computed(() => [...(s.value?.rounds || [])].reverse().find(r => r.status === 'recorded'));
const seriesPayload = (team: Team, value: number) => ({ ...s.value!.series, [team]: value, reason: note('直播员核对后直接校正系列比分') });
const display = (scene: string) => run('display', { scene });
const onKey = (event: KeyboardEvent) => {
  if (event.ctrlKey || event.metaKey || !event.altKey || event.defaultPrevented || disabled.value) return;
  const element = event.target as HTMLElement;
  if (element?.isContentEditable || /INPUT|SELECT|TEXTAREA|BUTTON/.test(element?.tagName || '')) return;
  const shortcuts: Record<string, string> = { '1': 'waiting', '2': 'roll', '3': 'mappool', '4': 'playing', '5': 'victory' };
  const key = event.code.startsWith('Digit') ? event.code.slice(5) : event.key;
  if (shortcuts[key]) { event.preventDefault(); void display(shortcuts[key]!); }
};
onMounted(() => { window.addEventListener('message', previewReady); previewHeartbeat = setInterval(sharePreview, 5000); document.body.classList.add('is-control'); document.title = 'OCLR · 直播员控制台'; window.addEventListener('keydown', onKey); });
onUnmounted(() => { window.removeEventListener('message', previewReady); clearInterval(previewHeartbeat); for (const timer of settingTimers.values()) clearTimeout(timer); settingQueue.clear(); document.body.classList.remove('is-control'); window.removeEventListener('keydown', onKey); });
const operationTime = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
</script>

<template>
  <main class="operator" :class="{ 'motion-ready': motionReady }">
    <header class="operator-header">
      <div class="operator-brand"><span class="operator-kicker">OCLR {{ s?.match.edition?.toUpperCase() || 'S11' }} / BROADCAST</span><h1>直播控制台</h1></div>
      <div class="operator-match"><span>{{ names.a }}</span><strong>{{ series.a }} : {{ series.b }}</strong><span>{{ names.b }}</span></div>
      <div class="operator-edition">{{ s?.match.title }}<br>{{ s?.match.stage === 'final' ? '决赛 · BO13' : s?.match.stage === 'elimination' ? '淘汰赛 · BO11' : '小组赛 · BO11' }} · 先赢 {{ target }} 图</div>
    </header>
    <nav class="operator-tabs" aria-label="控制台页面">
      <button :aria-pressed="!settings && !diagnostics" @click="settings = false; diagnostics = false">比赛中操作</button>
      <button :aria-pressed="settings" @click="settings = true; diagnostics = false">开播前设置</button>
      <button :aria-pressed="diagnostics" @click="diagnostics = true; settings = false">维护详情</button>
      <a href="/overlay" target="_blank" rel="noopener">打开独立输出 ↗</a>
    </nav>
    <p v-if="!s" class="operator-empty">正在连接本场比赛。连接恢复后会自动显示原有记录。</p>
    <template v-if="s">
      <nav class="operator-scenes" aria-label="一键切换播出画面">
        <span>播出画面</span><button v-for="[scene, label] in scenes" :key="scene" :disabled="disabled" :data-unavailable="connection !== 'synced'" :aria-pressed="s.scene === scene" @click="display(scene)">{{ label }}</button>
      </nav>
      <section class="operator-toolbar" aria-label="随时可用的比赛操作">
        <span class="operator-follow-status">{{ connection !== 'synced' ? '控制台连接中断' : s.incident ? '等待核对 · 暂不加分' : s.paused ? '明确暂停中' : !(s.auto.bp || s.auto.scenes || s.auto.results) ? '自动化已明确关闭' : live?.tosu.status !== 'live' || s.auto.profile !== 'stable-tourney' || !s.auto.left || !s.auto.right || live?.tosu.data?.tourney?.teams.left !== s.auto.left || live?.tosu.data?.tourney?.teams.right !== s.auto.right ? '等待房间资料 · 自动化保持开启' : s.sceneOverride ? '画面覆盖 · 数据跟随继续' : '自动流程待命' }}</span>
        <button v-if="!s.paused" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('pause', { kind: 'technical' })">暂停播出</button>
        <button v-else class="operator-primary" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('resume')">返回{{ sceneLabels[s.returnScene as Scene] || '原画面' }}</button>
        <button :disabled="disabled || !s.canUndo" :data-unavailable="connection !== 'synced' || !s.canUndo" @click="run('undo')">撤销上一项</button>
        <button v-if="round" @click="showIncidents()">处理异常</button><button @click="showAdjustments">手动调整 / 改比分</button>
        <button class="operator-reset" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="openInitialize">初始化</button>
      </section>
      <p class="operator-hint" role="status">{{ live?.note }}</p>
      <section class="operator-ex-quick" aria-label="EX 常用操作">
        <div class="operator-ex-mode" role="group" aria-label="本图 EX 开启方" aria-describedby="ex-quick-hint">
          <span>本图 EX</span>
          <button :aria-pressed="!s.ex.team" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="setExTeam(null)">关闭 EX</button>
          <button v-for="team in (['a', 'b'] as const)" :key="team" :data-team="team" :aria-pressed="s.ex.team === team" :aria-label="`${names[team]} 开启 EX`" :disabled="disabled || exUnavailable(team)" :data-unavailable="connection !== 'synced' || exUnavailable(team)" :title="s.ex.remaining[team] <= 0 && s.ex.team !== team ? '该队没有 EX 剩余次数' : exHint" @click="setExTeam(team)">{{ names[team] }} {{ s.ex.team === team ? '已开启 EX' : '开启 EX' }}</button>
        </div>
        <div class="operator-ex-counters" role="group" aria-label="EX 剩余次数">
          <span>剩余次数</span><div v-for="team in (['a', 'b'] as const)" :key="team" class="operator-ex-team" :data-team="team"><strong>{{ names[team] }}</strong><button :aria-label="`${names[team]} EX 次数减一`" :disabled="disabled || s.ex.remaining[team] <= 0" :data-unavailable="connection !== 'synced' || s.ex.remaining[team] <= 0" @click="adjustExCount(team, -1)">−</button><output :aria-label="`${names[team]} EX 剩余次数`">{{ s.ex.remaining[team] }}</output><button :aria-label="`${names[team]} EX 次数加一`" :disabled="disabled || s.ex.remaining[team] >= 2" :data-unavailable="connection !== 'synced' || s.ex.remaining[team] >= 2" @click="adjustExCount(team, 1)">＋</button></div>
        </div>
        <p id="ex-quick-hint" class="operator-hint">{{ exHint }}</p>
      </section>
      <div class="operator-notice" aria-label="操作反馈" :aria-busy="busy">
        <p v-show="error || localError" role="alert" class="operator-error">{{ localError || error }}</p>
        <p v-show="!error && !localError" class="operator-feedback" :class="{ 'operator-feedback--undo': feedbackKind === 'undo' }" role="status">{{ feedback }}</p>
      </div>
      <section v-show="settings" class="operator-setup" aria-label="本场设置">
        <div class="operator-section-head"><h2>本场设置</h2><span>修改后自动同步，无需保存；已有比赛记录保留</span></div>
        <div class="setup-meta">
          <label>比赛标题<input v-model="form.title" aria-label="比赛标题" maxlength="160" @input="scheduleSetting('title')" @blur="dirtySettings.has('title') && scheduleSetting('title', true)"><span class="operator-hint" aria-live="polite">{{ settingMessages.title }}</span></label>
          <label>阶段<ControlSelect :value="s.match.stage" :disabled="disabled" :data-unavailable="connection !== 'synced'" aria-describedby="stage-hint" @change="changeStage"><option value="group">小组赛 · BO11</option><option value="elimination">淘汰赛 · BO11</option><option value="final">决赛 · BO13</option></ControlSelect><span id="stage-hint" class="operator-hint">选择后立即同步播出画面</span></label>
          <label>常规人数<ControlSelect v-model="form.mode" aria-label="常规人数" @change="scheduleSetting('mode', true)"><option>3v3</option><option>4v4</option></ControlSelect><span class="operator-hint" aria-live="polite">{{ settingMessages.mode }}</span></label>
          <label>游戏源比例<ControlSelect v-model="form.source" aria-label="游戏源比例" @change="scheduleSetting('source', true)"><option value="4x3">4:3</option><option value="16x9">16:9</option></ControlSelect><span class="operator-hint" aria-live="polite">{{ settingMessages.source }}</span></label>
        </div>
        <details class="operator-import"><summary>从 OCLR 已发布资料选择</summary>
          <div class="operator-inline"><label>赛季 slug<input v-model="selection.edition" maxlength="80" @input="scheduleSetting('edition')" @blur="dirtySettings.has('edition') && scheduleSetting('edition', true)"><span class="operator-hint" aria-live="polite">{{ settingMessages.edition }}</span></label></div>
          <p>只读已发布资料；空集合保持为空，不自动填入其他赛季。</p>
          <p v-if="catalog?.kind === 'historical_archive'">{{ catalog.edition?.toUpperCase() }} 历史归档 · {{ catalog.capturedOn }} · 历史比分仅作参考，本地播出从零开始；图池未绑定的历史场次须明确选择图池。</p>
          <p v-for="warning in catalog?.warnings" :key="warning">{{ warning }}</p>
          <div class="setup-meta">
            <label>场次<ControlSelect v-model="selection.fixtureId" @change="fixtureSelected"><option value="">未选择 / 人工对阵</option><option v-for="f in catalog?.fixtures" :key="f.id" :value="f.id">{{ f.roundName }} {{ f.label }}</option></ControlSelect></label>
            <label>图池<ControlSelect v-model="selection.poolId" @change="scheduleSetting('import', true)"><option value="">请选择</option><option v-for="p in catalog?.pools" :key="p.id" :value="p.id">{{ p.name }}</option></ControlSelect></label>
            <label>左队<ControlSelect v-model="selection.leftTeamId" @change="scheduleSetting('import', true)"><option value="">请选择</option><option v-for="t in catalog?.teams" :key="t.id!" :value="t.id">{{ t.name }}</option></ControlSelect></label>
            <label>右队<ControlSelect v-model="selection.rightTeamId" @change="scheduleSetting('import', true)"><option value="">请选择</option><option v-for="t in catalog?.teams" :key="t.id!" :value="t.id">{{ t.name }}</option></ControlSelect></label>
          </div><p role="status">{{ settingMessages.import || '选择完整资料后立即使用；不改变已有比赛进度。' }}</p>
        </details>
        <div>
          <div class="setup-teams">
            <div><label>左队名称<input v-model="form.a" aria-label="左队名称" maxlength="80" required @input="scheduleSetting('a')" @blur="dirtySettings.has('a') && scheduleSetting('a', true)"><span class="operator-hint" aria-live="polite">{{ settingMessages.a }}</span></label><label>左队上场名单 · 每行一人<textarea v-model="form.rosterA" aria-label="左队上场名单 · 每行一人" @input="scheduleSetting('rosterA')" @blur="dirtySettings.has('rosterA') && scheduleSetting('rosterA', true)" rows="4" placeholder="按窗口顺序录入实际选手"></textarea><span class="operator-hint" aria-live="polite">{{ settingMessages.rosterA }}</span></label></div>
            <div><label>右队名称<input v-model="form.b" aria-label="右队名称" maxlength="80" required @input="scheduleSetting('b')" @blur="dirtySettings.has('b') && scheduleSetting('b', true)"><span class="operator-hint" aria-live="polite">{{ settingMessages.b }}</span></label><label>右队上场名单 · 每行一人<textarea v-model="form.rosterB" aria-label="右队上场名单 · 每行一人" @input="scheduleSetting('rosterB')" @blur="dirtySettings.has('rosterB') && scheduleSetting('rosterB', true)" rows="4" placeholder="按窗口顺序录入实际选手"></textarea><span class="operator-hint" aria-live="polite">{{ settingMessages.rosterB }}</span></label></div>
            <label>本场图池 · 每行「标签 谱面ID 标题」<textarea v-model="form.pool" aria-label="本场图池 · 每行「标签 谱面ID 标题」" @input="scheduleSetting('pool')" @blur="dirtySettings.has('pool') && scheduleSetting('pool', true)" rows="7" placeholder="HD2 谱面ID 标题" spellcheck="false"></textarea><span class="operator-hint" aria-live="polite">{{ settingMessages.pool }}</span></label>
          </div><p>文字输入停顿后自动同步；无效内容保留在输入框并显示原因，播出继续使用上一次有效设置。名单与图池修改会标为人工资料。</p>
        </div>
          <details class="operator-follow"><summary>房间连接与自动跟随 <span>{{ s.auto.bp || s.auto.scenes || s.auto.results ? '已启用' : '关闭' }}</span></summary>
            <p>先在直播机确认 tosu 选中实例与当前赛事房间一致，再选择客户端并填写房间中的实际队名。</p>
            <label>赛事客户端<ControlSelect v-model="autoForm.profile" @change="scheduleSetting('auto', true)"><option value="unverified">尚未核对</option><option value="stable-tourney">stable / osu!tourney（已核对）</option></ControlSelect></label>
            <div class="operator-two"><label>房间左队名称<input v-model="autoForm.left" maxlength="80" @input="scheduleSetting('auto')" @blur="dirtySettings.has('auto') && scheduleSetting('auto', true)"></label><label>房间右队名称<input v-model="autoForm.right" maxlength="80" @input="scheduleSetting('auto')" @blur="dirtySettings.has('auto') && scheduleSetting('auto', true)"></label></div>
            <p>当前读数：{{ live?.tosu.data?.tourney?.teams.left || '—' }} / {{ live?.tosu.data?.tourney?.teams.right || '—' }} · IPC {{ live?.tosu.data?.tourney?.ipcState ?? '—' }} · 谱面 {{ live?.tosu.data?.beatmap.id ?? '—' }}</p>
            <label class="operator-check"><input v-model="autoForm.bp" type="checkbox" @change="scheduleSetting('auto', true)">按当前 BP 动作自动 Ban / Pick</label>
            <label class="operator-check"><input v-model="autoForm.scenes" type="checkbox" @change="scheduleSetting('auto', true)">有效换图 / 开打 / 结算自动切换画面</label>
            <label class="operator-check"><input v-model="autoForm.results" type="checkbox" @change="scheduleSetting('auto', true)">正常结算按最终队分自动加赢图</label><p role="status">{{ settingMessages.auto || '自动化默认开启；资料不足时等待，恢复后自动建立基线。明确暂停保留，普通人工修正立即生效。' }}</p>
          </details>
        <details class="operator-follow"><summary>纠错：修改后续 BP 顺序</summary><p>新比赛按 Roll 两项先手自动编排。这里用于已有比赛或人工纠错，只替换后续动作，保留当前动作与已发生记录；修改后按此手动顺序推进，不再自动补充交替 Pick。</p>
          <div v-for="(row, i) in plan.rows" :key="i" class="operator-plan-row"><label>第 {{ i + 1 }} 项队伍<ControlSelect v-model="row.team" @change="scheduleSetting('plan', true)"><option value="">请选择</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label><label>动作<ControlSelect v-model="row.kind" @change="scheduleSetting('plan', true)"><option value="">请选择</option><option value="ban">Ban</option><option value="pick">Pick</option></ControlSelect></label><label v-if="row.kind === 'ban'">Ban 槽<ControlSelect v-model="row.slot" @change="scheduleSetting('plan', true)"><option :value="-1">请选择</option><option :value="0">Ban 1</option><option :value="1">Ban 2</option></ControlSelect></label><button @click="plan.rows.splice(i, 1); scheduleSetting('plan', true)">删除第 {{ i + 1 }} 项</button></div>
          <div class="operator-inline"><button :disabled="plan.rows.length >= 40" @click="plan.rows.push({ team: '', kind: '', slot: -1 }); scheduleSetting('plan', true)">添加一项</button><button @click="plan.rows = s.queue.map(a => ({ team: a.team, kind: a.kind, slot: a.slot ?? -1 }))">载入现有后续动作</button></div><label>核实来源 / 负责人（可选）<input v-model="plan.verifiedBy" maxlength="160" placeholder="可补充本场顺序的来源" @input="scheduleSetting('plan')" @blur="dirtySettings.has('plan') && scheduleSetting('plan', true)"></label><p role="status">{{ settingMessages.plan || '队伍与动作选全后自动生效；核实来源可选。' }}</p>
        </details>
      </section>

      <section v-if="diagnostics" class="operator-records" aria-label="维护详情">
        <h2>维护详情</h2><p>连接、原始读数与存储状态供维护人员检查。比赛中无需操作这些字段。</p>
        <dl class="operator-diagnostics"><dt>控制台同步</dt><dd>{{ connection }} · v{{ s.version }}</dd><dt>游戏数据</dt><dd>{{ live?.tosu.status }} · {{ live?.tosu.updatedAt || '尚无有效数据' }}</dd><dt>赛事资料</dt><dd>{{ live?.oclr.status }} · {{ live?.oclr.error || '—' }}</dd><dt>存储</dt><dd>{{ snapshot?.persistence }}</dd><dt>房间 / IPC</dt><dd>{{ live?.tosu.data?.tourney?.teams.left || '—' }} / {{ live?.tosu.data?.tourney?.teams.right || '—' }} · {{ live?.tosu.data?.tourney?.ipcState ?? '—' }}</dd><dt>当前谱面</dt><dd>{{ live?.tosu.data?.beatmap.id ?? '—' }}</dd><dt>自动观察器</dt><dd>{{ live?.note }}</dd></dl>
        <p>未完成真实 osu!tourney / tosu / OBS 时序联调。完整旧快照仍可能被提前计胜；分数一致或稳定都不能证明所有人已结束。日志录制与模拟器由开发维护人员使用。</p>
      </section>
      <template v-if="!settings && !diagnostics">

        <div class="operator-workspace">
          <section class="operator-actions" aria-label="当前画面管理">
            <section class="operator-situation" aria-label="当前画面管理说明"><div><span class="operator-kicker">{{ sceneLabels[s.scene as Scene] }} · 管理</span><h2>{{ panelHeading }}</h2><p>{{ nextStep }}</p><p v-if="round && scorePanel" class="operator-round-context">当前图 {{ entry(round.entryId)?.label }} · {{ roundStatus[round.status] }}</p></div><span :class="{ 'status-good': connection === 'synced' }">{{ connection === 'synced' ? '画面已同步' : '等待重连' }}<br>{{ gameStatus }}</span></section>
            <div v-if="panel === 'waiting'" class="operator-action-stack">
              <div class="operator-two"><div v-for="team in (['a', 'b'] as const)" :key="team" class="operator-team-status" :data-team="team"><h3>{{ names[team] }}</h3><label class="operator-check"><input type="checkbox" :checked="s.arrived[team]" :disabled="disabled" :data-unavailable="connection !== 'synced'" @change="run('arrival', { team, arrived: !s.arrived[team], ready: false })">已到场</label><label class="operator-check"><input type="checkbox" :checked="s.ready[team]" :disabled="disabled || !s.arrived[team]" :data-unavailable="connection !== 'synced' || !s.arrived[team]" @change="run('arrival', { team, arrived: true, ready: !s.ready[team] })">已就绪</label></div></div>
              <button class="operator-primary" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="display('roll')">开始 Roll →</button>
            </div>
            <div v-else-if="panel === 'roll'" class="operator-action-stack">
              <div class="operator-two"><label>{{ names.a }} Roll<input v-model="rollForm.a" type="number" min="0" step="1" @input="scheduleSetting('roll')" @blur="dirtySettings.has('roll') && scheduleSetting('roll', true)"></label><label>{{ names.b }} Roll<input v-model="rollForm.b" type="number" min="0" step="1" @input="scheduleSetting('roll')" @blur="dirtySettings.has('roll') && scheduleSetting('roll', true)"></label></div>
              <label v-for="[field, label] in ([['winner', 'Roll 胜方'], ['pickFirst', '先 Pick'], ['banFirst', '先 Ban']] as const)" :key="field">{{ label }}<ControlSelect v-model="rollForm[field]" @change="scheduleSetting('roll', true)"><option value="">未确认</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label><p role="status">{{ settingMessages.roll || '两项先手分别选全后，新比赛立即建立 BP，无需保存或编排。' }}</p>
              <p class="operator-action-now">当前：{{ bpCurrent }}</p>
              <p v-if="s.bp?.next">接下来：{{ actionText(s.bp.next) }}（每次 Pick 后先打完本图）</p>
              <p v-if="s.bp?.rollChanged">已发生 BP，先手修正仅更新 Roll 展示。后续如需更正，请在“手动调整”修改当前动作，在“本场设置 → 纠错：修改后续 BP 顺序”调整后续。</p>
              <button :disabled="disabled" @click="display('mappool')">查看图池 / BP →</button>
            </div>
            <div v-else-if="panel === 'mappool'" class="operator-action-stack">
              <div class="operator-bp-progress" aria-label="真实 BP 进度" aria-live="polite">
                <h3>当前：{{ bpCurrent }}</h3>
                <p v-if="s.bp?.next">接下来：{{ actionText(s.bp.next) }}{{ round?.status === 'prepared' || round?.status === 'playing' ? '（本图结束后）' : s.action?.kind === 'pick' ? '（选图并打完本图后）' : '' }}</p>
                <p v-if="s.bp?.mode !== 'roll'">保留本场原有手动顺序。可在“手动调整”修正当前动作，在“本场设置”调整后续。</p>
                <p v-if="s.bp?.rollChanged">Roll 先手已修正；真实 BP 顺序保持原样，需要时使用手动纠错。</p>
              </div>
              <section class="operator-next-action" aria-label="选择下一 BP 动作">
                <h3>下一动作 · 可以先选动作，再等换图</h3>
                <div class="operator-bp-buttons"><template v-for="team in (['a', 'b'] as const)" :key="team"><button v-for="kind in (['ban', 'pick'] as const)" :key="kind" :data-team="team" :aria-pressed="s.action?.team === team && s.action.kind === kind" :disabled="disabled || !!s.incident || s.paused || !!s.bp?.stopped || round?.status === 'prepared' || round?.status === 'playing'" @click="run('select-bp-action', { team, kind })">下一步：{{ names[team] }} {{ kind === 'ban' ? 'Ban' : 'Pick' }}</button></template></div>
                <p>选择后等待新的 tosu 换图；没有有效连接时继续等待。人工补做时再点谱面，完成当前真实动作。</p>
              </section>
              <div class="operator-pool-actions"><p class="operator-action-now">{{ poolSelection ? `${poolSelection.label} · ${poolState(poolSelection.id) || '无标记'}` : '先点选一张谱面' }}</p>
              <button v-if="s.bp?.canApply" class="operator-primary" :disabled="disabled || !canCompleteBp" @click="run('apply-bp', { entryId: poolEntryId, actionId: s.action?.id })">人工完成当前真实 {{ s.action?.kind === 'ban' ? 'Ban' : 'Pick' }} · {{ s.action ? names[s.action.team] : '' }}{{ poolSelection ? ` · ${poolSelection.label}` : '（先点选谱面）' }}</button>
              <button v-if="s.bp?.canReplace" :disabled="disabled || !canReplaceBp" @click="run('apply-bp', { entryId: poolEntryId })">替换本次准备图{{ poolSelection ? ` · ${poolSelection.label}` : '（先点选谱面）' }}</button>
              <button v-if="s.bp?.canApply && s.action?.kind === 'ban'" :disabled="disabled" @click="run('skip-ban', { actionId: s.action.id, reason: note('裁判确认本次放弃 / 空 Ban') })">裁判已确认空 Ban，进入下一步</button>
              <p>以下只改播出标记，不推进真实 BP：</p>
              <div class="operator-bp-buttons"><template v-for="team in (['a', 'b'] as const)" :key="team"><button v-for="kind in (['banned', 'picked'] as const)" :key="kind" :data-team="team" :aria-pressed="selectedMark?.team === team && selectedMark.status === kind" :disabled="disabled || !poolSelection" :data-unavailable="connection !== 'synced' || !poolSelection" @click="markPool(kind, team)">{{ names[team] }} {{ kind === 'banned' ? 'Ban' : 'Pick' }}</button></template></div>
              <button :disabled="disabled || !poolSelection || selectedMark?.status === 'open'" :data-unavailable="connection !== 'synced' || !poolSelection || selectedMark?.status === 'open'" @click="markPool('open', null)">清除标记</button></div>
              <div class="operator-pool" aria-label="本场图池"><button v-for="e in s.pool" :key="e.id" :data-mod="e.mod" :data-team="poolDisplay(s, e.id).team" :data-map-state="poolDisplay(s, e.id).status" :aria-pressed="poolEntryId === e.id" :title="e.title || `谱面 ${e.beatmapId}`" @click="poolEntryId = e.id"><strong>{{ e.label }}</strong><span>{{ e.title || `谱面 ${e.beatmapId}` }}</span><small v-if="poolState(e.id)">{{ poolState(e.id) }}</small></button></div>
              <p v-if="!s.pool.length">还没有图池，请在本场设置选择真实资料。</p>
              <p>已打过的图也可以修改标记。开打和记胜在 Playing 面板操作。</p>
              <details v-if="!s.bp?.canReplace && round?.status !== 'playing' && series.a < target && series.b < target" class="operator-prepare"><summary>裁判确认后的 TB 单独准备</summary><p>TB 不属于普通 Pick。由裁判确认是否进入 TB；禁 Ban、禁 EX，不自动判罚。</p><label>TB 谱面<ControlSelect v-model="tbForm.entryId"><option value="">请选择</option><option v-for="e in s.pool.filter(e => e.mod === 'TB')" :key="e.id" :value="e.id">{{ e.label }} · {{ e.title || e.beatmapId }}</option></ControlSelect></label><label>本图归属记录（由裁判核对）<ControlSelect v-model="tbForm.pickedBy"><option value="">请选择</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label><button :disabled="disabled || !tbForm.entryId || !tbForm.pickedBy || !!s.incident || s.paused" @click="run('prepare-round', { ...tbForm, tiebreaker: true, ifCurrentRoundId: s.currentRoundId })">裁判已确认，单独准备 TB</button></details>
            </div>
            <div v-else-if="scorePanel" class="operator-action-stack">
              <details class="operator-prepare"><summary>{{ round?.status === 'prepared' ? '更换本局谱面' : round?.status === 'playing' ? '本局进行中，结束后再准备下一图' : round ? '选择下一局谱面' : '选择本局谱面' }}</summary><label>本局谱面<ControlSelect v-model="prepareForm.entryId" :disabled="round?.status === 'playing'" @change="scheduleSetting('prepare', true)"><option value="">请选择</option><option v-for="e in s.pool" :key="e.id" :value="e.id">{{ e.label }} · {{ e.title || e.beatmapId }}</option></ControlSelect></label><label>选图队伍<ControlSelect v-model="prepareForm.pickedBy" :disabled="round?.status === 'playing'" @change="scheduleSetting('prepare', true)"><option value="">请选择</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label><p role="status">{{ settingMessages.prepare || '谱面与选图队伍选全后立即准备；自动等待有效开打。' }}</p><p>准备好后标记开打；已记录的赛果保留。</p></details>
              <section class="operator-series-edit"><h3>直接校正系列比分</h3><div class="operator-two"><label v-for="team in (['a', 'b'] as const)" :key="team">{{ names[team] }} 赢图<input v-model.number="correctedScore[team]" :aria-label="`${names[team]} 赢图`" :aria-describedby="`series-${team}-status`" type="number" min="0" :max="target" step="1" required @input="scheduleSetting(`series-${team}`, true)"><span :id="`series-${team}-status`" class="operator-hint" aria-live="polite">{{ settingMessages[`series-${team}`] }}</span></label></div><p>有效比分修改后立即同步，无需确认；保留逐局记录，后续赢图从此比分继续累计。</p></section>
              <button v-if="round?.status === 'prepared'" :disabled="disabled || !!s.incident || !!s.action" :data-unavailable="connection !== 'synced' || !!s.incident || !!s.action" @click="run('start')">手动标记本局开打</button>
              <button v-if="round?.status === 'playing'" :disabled="disabled || !!s.incident || s.paused" @click="run('ranking')">本图已结束，继续 BP（暂不计胜）</button>
              <section v-if="resultRound" id="manual-result" class="operator-result">
                <h3>人工记录胜方</h3><label>本图<ControlSelect v-model="resultRound"><option v-for="r in s.rounds.filter(r => ['playing', 'ranking'].includes(r.status))" :key="r.id" :value="r.id">{{ entry(r.entryId)?.label }} · {{ roundStatus[r.status] }}{{ r.id !== s.currentRoundId ? '（上一局）' : '' }}</option></ControlSelect></label>
                <div class="operator-two"><button v-for="team in (['a', 'b'] as const)" :key="team" :disabled="disabled || !resultRound" :data-unavailable="connection !== 'synced' || !resultRound" @click="recordResult(team)">记{{ recordingPrevious ? '上一局' : '本图' }} {{ names[team] }} 胜</button></div><p>按实际赛果直接记胜；计错可撤回或修正。</p>
              </section>
              <details v-if="latestResult" class="operator-latest-result"><summary>{{ entry(latestResult.entryId)?.label }} 已记 {{ latestResult.winner ? names[latestResult.winner] : '—' }} 胜 · 修正</summary><p>{{ latestResult.resultSource === 'tosu' ? '自动记录；若成绩仍有变化会转为等待核对。发现胜方错误可立即修正。' : '人工记录优先，旧数据不会覆盖。' }}</p><div class="operator-inline"><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('correct-result', { roundId: latestResult.id, winner: latestResult.winner === 'a' ? 'b' : 'a', reason: '直播员核对后修正本图胜方' })">改为 {{ names[latestResult.winner === 'a' ? 'b' : 'a'] }} 胜</button><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('retract-result', { roundId: latestResult.id, reason: '直播员撤回本图计胜，等待核对' })">撤回本图计胜</button></div></details>
              <div v-if="!resultRound && !latestResult"><p>尚无已开打或待记录的本图。系列比分仍可直接校正。</p></div>
              <template v-for="team in (['a', 'b'] as const)" :key="team"><button v-if="series[team] >= target" :disabled="disabled || !!s.incident" :data-unavailable="connection !== 'synced' || !!s.incident" @click="run('winner', { team })">展示 {{ names[team] }} Winner</button></template>
            </div>
            <div v-else-if="panel === 'victory'" class="operator-action-stack"><h3>{{ s.winner ? names[s.winner] : '胜方待确认' }} · {{ series.a }} : {{ series.b }}</h3><button v-for="team in (['a', 'b'] as const)" :key="team" :disabled="disabled || !!s.incident || series[team] < target" :data-unavailable="connection !== 'synced' || !!s.incident || series[team] < target" @click="run('winner', { team })">确认 {{ names[team] }} 为胜方</button><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="openInitialize">存档并准备下一场</button></div>
            <div v-else-if="panel === 'pause'" class="operator-action-stack"><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('pause', { kind: 'technical' })">技术暂停</button><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('pause', { kind: 'tactical' })">战术暂停</button><button :disabled="disabled || !s.returnScene" :data-unavailable="connection !== 'synced' || !s.returnScene" @click="run('resume')">返回暂停前的画面</button></div>
          </section>
          <aside class="operator-side">
            <section class="operator-preview"><div class="operator-section-head"><h2>当前播出画面</h2><span>{{ sceneLabels[s.scene as Scene] }}</span></div><iframe ref="preview" src="/overlay" title="共享浏览器输出预览" @load="sharePreview"></iframe>

            </section>
            <section v-if="round && (incidentOpen || s.incident)" id="incident-panel" class="operator-incident" aria-label="现场处理"><div class="operator-section-head"><h2>现场处理</h2><button v-if="!s.incident" @click="incidentOpen = false">收起</button></div>
              <div v-if="s.incident" class="operator-incident-status" role="status"><strong>暂不加分 · 等待处理</strong><p>{{ round.resultSource === 'review' ? '成绩尚未确认' : incidentLabels[s.incident.kind] }}</p><p>{{ round.resultSource === 'review' ? '自动计胜后分数仍在变化。已撤回本图自动加分；等全部结束，再核对胜方。' : s.incident.source === 'tosu' ? '观战资料有变化，请核对比赛是否仍在继续。' : s.incident.reason }}</p></div>
              <template v-if="round.status !== 'void'">
                <button v-if="round.status === 'prepared'" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="hold('abort', '开打前卡住或取消启动，保留原选图')">还没开始就卡住 / 取消启动</button>
                <button v-else :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="hold('player-disconnect', '有人卡住，先等全部结束，暂停本图自动加分')">有人卡住，先等一下</button>
                <button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="hold('spectator', '直播观战画面异常，比赛可能仍在继续，保留本次开打')">直播画面异常，比赛仍在继续</button>
                <button v-if="s.incident && round.status !== 'ranking'" class="operator-primary" :disabled="disabled || !canContinueRound" :data-unavailable="connection !== 'synced' || !canContinueRound" @click="run('resolve-incident', { reason: incidentNote(round.status === 'prepared' ? '保留原选图，继续等待开打' : '直播员确认观战恢复，继续同一次开打') })">{{ round.status === 'prepared' ? '保留原图，继续等开打' : '观战已恢复，继续原局' }}</button>
                <p v-if="s.incident && round.status !== 'prepared'">恢复观战后仍在比赛，可继续原局；若已结束，请在 Playing 面板核对后人工记胜。</p>
                <button v-if="round.status !== 'prepared'" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('referee-replay', { reason: incidentNote('裁判已明确要求本图重赛') })">裁判已要求重赛本图</button>
                <label>补充说明（可选）<input v-model="incidentReason" maxlength="160" placeholder="无需填写也能处理"></label><p>等待或重赛会撤回本图已有计胜。重赛只更新播出记录，保留 Pick、BP、EX 与其余系列比分，等待房间重新开打。若比分曾直接校正，请同时核对系列比分。</p>
              </template><p v-else>本次开打已作废，请等待重新开打。</p>
            </section>
          </aside>
        </div>
        <details id="manual-adjustments" class="operator-records" :open="adjustments" @toggle="adjustments = ($event.target as HTMLDetailsElement).open">
          <summary>更多调整 · 谱面 / BP / Ban / 先手 / EX / 比分</summary><div class="operator-inline"><button v-if="resultRound" @click="showManualResult">到 Playing 管理比分</button><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('pause', { kind: 'tactical' })">展示战术暂停</button></div><p>每项只修改对应内容，可用顶部“撤销上一项”恢复。当前系列比分 {{ series.a }} : {{ series.b }}。</p><label>调整补充说明（可选）<input v-model="reason" maxlength="160" placeholder="不填写时自动记录操作原因"></label>
          <div class="operator-manual-grid">
            <section><h3>当前谱面与 Pick 方</h3><label>谱面<ControlSelect v-model="mapForm.entryId" :disabled="!canHandleRound" @change="scheduleSetting('round', true)"><option value="">选择要改成的谱面</option><option v-for="e in s.pool" :key="e.id" :value="e.id">{{ e.label }} · {{ e.title || e.beatmapId }}</option></ControlSelect></label><label>Pick 方<ControlSelect v-model="mapForm.pickedBy" :disabled="!canHandleRound" @change="scheduleSetting('round', true)"><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label><p role="status">{{ settingMessages.round || '修改后立即生效，保留同一局身份与自动流程。' }}</p><p>保留同一轮记录。已计胜的图先撤回，再调整。</p><button :disabled="disabled || !round || round.status === 'recorded'" :data-unavailable="connection !== 'synced' || !round || round.status === 'recorded'" @click="run('void-round', { reason: note('直播员作废当前选图，重新安排 BP') })">作废当前选图，重新 BP</button></section>
            <section><h3>当前 BP 动作</h3><div class="operator-two"><label>队伍<ControlSelect v-model="actionForm.team" @change="scheduleSetting('action', true)"><option value="">请选择</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label><label>动作<ControlSelect v-model="actionForm.kind" @change="scheduleSetting('action', true)"><option value="">请选择</option><option value="ban">Ban</option><option value="pick">Pick</option></ControlSelect></label></div><label v-if="actionForm.kind === 'ban'">Ban 槽<ControlSelect v-model="actionForm.slot" @change="scheduleSetting('action', true)"><option :value="-1">请选择</option><option :value="0">Ban 1</option><option :value="1">Ban 2</option></ControlSelect></label><p role="status">{{ settingMessages.action || '队伍与动作选全后立即生效，不改变后续顺序。' }}</p><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('set-action', { action: null })">取消当前动作</button><button :disabled="disabled || !!s.incident" :data-unavailable="connection !== 'synced' || !!s.incident" @click="run('bp')">手动回到 BP 操作</button><p>只改当前动作，不猜测或重排后续顺序。</p></section>
            <section><h3>真实 Ban 记录</h3><div v-for="team in (['a', 'b'] as const)" :key="team"><strong>{{ names[team] }}</strong><div v-for="(id, index) in s.bans[team]" :key="index" class="operator-inline"><span>Ban {{ index + 1 }} · {{ s.emptyBans?.[team][index] ? '空 Ban' : entry(id)?.label || '未确认' }}</span><button v-if="id || s.emptyBans?.[team][index]" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('clear-ban', { team, slot: index, reason: note('直播员修正该 Ban 槽位') })">清除此 Ban</button></div></div><p>清除不倒退 BP；可撤销上一项，或手动指定需要补做的动作。播出标记直接在图池修改。</p></section>
            <section><h3>Roll 与先手修正</h3><label v-for="[field, label] in ([['winner', 'Roll 胜方'], ['pickFirst', '先 Pick'], ['banFirst', '先 Ban']] as const)" :key="field">{{ label }}<ControlSelect v-model="rollForm[field]" @change="scheduleSetting('roll', true)"><option value="">未确认</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label><p role="status">{{ settingMessages.roll || '修改后立即生效，保留当前进度。' }}</p></section>
            <section><h3>EX 剩余次数修正</h3><p>本图开启／关闭请使用顶部 EX 常用操作。</p><div class="operator-two"><label>{{ names.a }} 剩余<input v-model.number="exForm.a" type="number" min="0" max="2" @input="scheduleSetting('ex-a')" @blur="dirtySettings.has('ex-a') && scheduleSetting('ex-a', true)"><span class="operator-hint" role="status">{{ settingMessages['ex-a'] }}</span></label><label>{{ names.b }} 剩余<input v-model.number="exForm.b" type="number" min="0" max="2" @input="scheduleSetting('ex-b')" @blur="dirtySettings.has('ex-b') && scheduleSetting('ex-b', true)"><span class="operator-hint" role="status">{{ settingMessages['ex-b'] }}</span></label></div><p>修改后自动同步，无需保存；不推定实际上场名单。</p></section>

          </div>
          <section><h3>逐局赛果修正</h3><div v-for="r in s.rounds.filter(r => r.status === 'recorded')" :key="r.id" class="operator-round-record"><span>{{ entry(r.entryId)?.label }} · {{ r.winner ? names[r.winner] : '未知' }} 胜 · {{ r.resultSource === 'tosu' ? '自动' : '人工' }}</span><div class="operator-inline"><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('correct-result', { roundId: r.id, winner: r.winner === 'a' ? 'b' : 'a', reason: note('直播员核对后修正胜方') })">改为 {{ names[r.winner === 'a' ? 'b' : 'a'] }} 胜</button><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('retract-result', { roundId: r.id, reason: note('直播员撤回计胜，等待核对') })">撤回计胜</button></div></div></section>
        </details>
        <details class="operator-records"><summary>最近操作记录</summary><ol class="operator-history"><li v-for="item in [...s.history].reverse().slice(0, 40)" :key="item.id"><time>{{ operationTime(item.at) }}</time><span>{{ item.message }}</span><b>{{ item.source === 'tosu' ? '自动' : '人工' }}</b></li><li v-if="!s.history.length">尚无操作记录</li></ol></details>
      </template>
    </template>
    <dialog ref="initializeDialog" class="operator-initialize-dialog" aria-labelledby="initialize-title" aria-describedby="initialize-description" @cancel="initializeError = ''">
      <form @submit.prevent="initializeMatch">
        <h2 id="initialize-title">初始化本场比赛？</h2>
        <p id="initialize-description">队伍、名单、图池、Roll、Ban/Pick、比分和比赛进度都会清空，房间跟随设置也会重置。</p>
        <p>当前比赛会先存档。误操作可用“撤销上一项”恢复。</p>
        <div class="operator-initialize-actions"><button type="button" autofocus @click="initializeDialog?.close()">取消</button><button type="submit" class="operator-reset" :disabled="disabled" :data-unavailable="connection !== 'synced'">清空并重新设置</button></div>
        <p class="operator-initialize-error" role="alert">{{ initializeError }}</p>
      </form>
    </dialog>
  </main>
</template>
