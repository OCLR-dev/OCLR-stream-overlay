<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useSession, type BpPhase, type PoolEntry, type Round } from '../session';
import { exhibitionFormat, sceneLabels, normalizeScene, stages, type Scene, type Team } from '../model';
import { operatorNextStep } from '../operatorHints';
import StreamingAccess from './StreamingAccess.vue';
import MapActionPopover from './MapActionPopover.vue';
import ControlSelect from './ControlSelect.vue';
import { poolDisplay } from '../poolDisplay';
import { modColorStyle } from '../modColors';
import { useMotionReady } from '../motion';
import { liveRoom, liveTeamScores, createPlayingScoreDisplay } from '../liveScores';
import { formatRosterInput, parseRosterInput } from '../rosterInput';
import { formatTeamScore } from '../scoreFormat';
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
// Keep the last complete totals on screen while a Panic reload temporarily
// invalidates the room; fresh room scores replace them as soon as they arrive.
const lastRoomScores = ref<{ key: string; left: number; right: number } | null>(null);
const automaticPanicGap = computed(() => {
  const session = s.value;
  return connection.value === 'synced' && !!session?.incident && session.incident.source === 'tosu' &&
    session.incident.kind === 'unverified' && session.incident.roundId === session.currentRoundId;
});
const readPlayingScores = createPlayingScoreDisplay();
const playingScores = ref<ReturnType<typeof readPlayingScores>>(null);
const roomScores = computed(() => {
  const live = playingScores.value;
  if (live) return live;
  const session = s.value;
  if (automaticPanicGap.value && session && lastRoomScores.value?.key === `${session.id}:${session.currentRoundId || ''}`)
    return { left: lastRoomScores.value.left, right: lastRoomScores.value.right };
  return null;
});
watch([snapshot, connection, () => s.value?.scene], ([envelope, link, scene]) => {
  playingScores.value = readPlayingScores(envelope, link);
  const scores = liveTeamScores(envelope, link);
  if (link === 'synced' && normalizeScene(scene) === 'playing' && scores &&
    Number.isSafeInteger(scores.left) && scores.left! >= 0 && Number.isSafeInteger(scores.right) && scores.right! >= 0) {
    lastRoomScores.value = { key: envelope?.session ? `${envelope.session.id}:${envelope.session.currentRoundId || ''}` : '',
      left: scores.left!, right: scores.right! };
  } else if (link !== 'synced' || normalizeScene(scene) !== 'playing') {
    lastRoomScores.value = null;
  }
}, { immediate: true, flush: 'sync' });
const roomScoreHint = computed(() => {
  const source = snapshot.value?.live.tosu;
  const scoring = source?.status === 'live' ? source.data?.tourney?.competitionScore : null;
  const hasScores = scoring?.rawTotalScore?.left != null || scoring?.rawTotalScore?.right != null;
  if (scoring && playingScores.value && (['left', 'right'] as const).some(side =>
    scoring.totalScore[side] === null && playingScores.value?.[side] != null)) return '队分同步中，暂时显示最近核对的分数。';
  return (hasScores && scoring?.reason) || (hasScores && scoring?.rule === 'fm-ez-v1' && !scoring.reason
    ? 'FM 队分已计入 EZ 选手1.5 倍计分，显示队分不代表已计胜。'
    : roomScores.value ? '来自游戏房间，显示队分不代表已计胜。' : '等待房间队分，未知分数显示 —。');
});
const teamScore = (value: number | null | undefined) => formatTeamScore(value);
const entry = (id?: string | null) => s.value?.pool.find(e => e.id === id);
const automaticTeamNames = computed(() => !!liveRoom(snapshot.value, connection.value));
const names = computed(() => ({ a: s.value?.match.teams.a.name || '左队', b: s.value?.match.teams.b.name || '右队' }));
const series = computed(() => s.value?.series || { a: 0, b: 0 });
// The countdown itself is owned by the local session service (an absolute
// deadline); the console only sends the operator's duration and ticks locally.
const pauseTimer = computed(() => s.value?.pauseTimer || null);
const pauseForm = reactive({ minutes: 3, seconds: 0 });
const pauseClockNow = ref(Date.now());
let pauseClockTimer: ReturnType<typeof setInterval> | undefined;
watch(() => pauseTimer.value?.endsAt, () => { pauseClockNow.value = Date.now(); });
const pauseRemainingSeconds = computed(() => {
  const timer = pauseTimer.value;
  if (!timer) return 0;
  return Math.ceil(Math.max(0, Math.min(timer.durationSeconds * 1000, timer.endsAt - pauseClockNow.value)) / 1000);
});
const pauseClockLabel = computed(() => `${String(Math.floor(pauseRemainingSeconds.value / 60)).padStart(2, '0')}:${String(pauseRemainingSeconds.value % 60).padStart(2, '0')}`);
const pauseInputValid = computed(() => {
  const minutes = Number(pauseForm.minutes); const seconds = Number(pauseForm.seconds);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= 60 && Number.isInteger(seconds) && seconds >= 0 && seconds <= 59 && minutes * 60 + seconds >= 1;
});
const pauseTimerHint = computed(() => {
  if (!pauseTimer.value) return '输入分和秒后开始倒计时；倒计时不会自动返回画面。';
  return pauseRemainingSeconds.value > 0 ? `剩余 ${pauseClockLabel.value}；到 0 不会自动返回画面。` : '倒计时已结束；核对现场后手动返回画面。';
});
const startPauseTimer = () => {
  if (!pauseInputValid.value) { localError.value = '倒计时需在 1 秒到 60 分钟之间。'; return; }
  void run('pause-timer', { seconds: Math.trunc(Number(pauseForm.minutes)) * 60 + Math.trunc(Number(pauseForm.seconds)) });
};
const clearPauseTimer = () => { void run('pause-timer', { clear: true }); };
const resumeAt = computed(() => s.value?.resumeAt || null);
const resumeRemainingSeconds = computed(() => resumeAt.value
  ? Math.ceil(Math.max(0, Math.min(10000, resumeAt.value - pauseClockNow.value)) / 1000)
  : 0);
const startResumeSoon = () => { void run('resume-soon'); };
watch(resumeAt, () => { pauseClockNow.value = Date.now(); });
const tb = computed(() => s.value?.bp?.tiebreaker);
const tbEntries = computed(() => s.value?.pool.filter(e => e.mod === 'TB') || []);
const tbButtonHint = computed(() => tbEntries.value.length > 1 ? '本场有多张 TB，请先在开播前设置确定唯一决胜图。' : tb.value?.reason || '先核对系列比分与赛制，再准备 TB。');
const roomReview = computed(() => connection.value === 'synced' ? snapshot.value?.roomReview : null);
const tbAlreadyPlayed = computed(() => roomReview.value?.kind === 'tb' && roomReview.value.stage !== 'ready');
const prepareTiebreaker = async (forReplay = false) => {
  if (!tb.value?.canPrepare || tbEntries.value.length !== 1) return;
  const entryId = tbEntries.value[0]!.id;
  if (await run('prepare-round', { entryId, tiebreaker: true, forReplay, ifCurrentRoundId: s.value?.currentRoundId })) {
    poolEntryId.value = '';
  }
};
const exhibition = computed(() => s.value?.match.exhibition);
const exhibitionProgress = computed(() => s.value?.exhibition);
const target = computed(() => exhibitionProgress.value?.limit ?? (s.value?.match.stage === 'final' ? 7 : 6));
const stageSummary = computed(() => {
  const stage = s.value?.match.stage ?? 'group';
  if (stage === 'exhibition') return `表演赛 · ${exhibition.value?.roundName || ''} · ${exhibitionFormat(exhibition.value?.series)}`;
  const meta = stages[stage];
  return `${meta.label} · ${meta.format} · 先赢 ${meta.target} 图`;
});
const canShowWinner = (team: Team) => exhibitionProgress.value ? exhibitionProgress.value.winner === team : (s.value?.series[team] ?? 0) >= target.value;
const resultMayDraw = computed(() => exhibition.value?.tiedMapPolicy === 'count_as_draw' &&
  s.value?.rounds.find(r => r.id === resultRound.value)?.status === 'ranking');
const winnerPending = computed(() => s.value?.winnerPending || null);
const winnerRemainingSeconds = computed(() => winnerPending.value
  ? Math.ceil(Math.max(0, Math.min(5000, winnerPending.value.endsAt - pauseClockNow.value)) / 1000)
  : 0);
watch(() => winnerPending.value?.endsAt, () => { pauseClockNow.value = Date.now(); });
const recordingPrevious = computed(() => !!resultRound.value && resultRound.value !== s.value?.currentRoundId);
const panel = computed(() => normalizeScene(s.value?.scene));
const scorePanel = computed(() => panel.value === 'playing');
const lastBp = computed(() => s.value?.bp?.retract);
const panelHeading = computed(() => s.value?.warmup ? 'Warm-up · 热身' : ({ waiting: '到场与就绪', roll: 'Roll 点数与先手', mappool: '图池 Ban / Pick', playing: '比分与赛果', victory: '全场胜方', pause: '暂停管理' }[panel.value]));
const scenes = [['waiting', '等待'], ['roll', 'Roll / 先手'], ['mappool', '图池 / BP'], ['playing', 'Playing'], ['victory', 'Winner']] as const;
const form = reactive({ title: 'OCLR S11', a: '', b: '', rosterA: '', rosterB: '', pool: '', mode: '4v4', source: '4x3' });
const rollForm = reactive({ a: '', b: '', winner: '', pickFirst: '', banFirst: '' });
const regularRollFields = [['winner', 'Roll 胜方'], ['pickFirst', '先 Pick'], ['banFirst', '先 Ban']] as const;
const rollFields = computed(() => exhibition.value ? regularRollFields.filter(([field]) => field !== 'banFirst') : regularRollFields);
const rollSetting = (field: keyof typeof rollForm) => `roll-${field}`;
const autoForm = reactive({ bp: true, scenes: true, results: true, profile: 'unverified', left: '', right: '' });
const actionForm = reactive({ kind: '', team: '', slot: -1 });
const mapForm = reactive({ entryId: '', pickedBy: '' });
const poolEntryId = ref('');
const poolAnchor = ref<HTMLElement>();
function closePoolMenu() {
  poolAnchor.value = undefined;
  poolEntryId.value = '';
}
function openPoolMenu(event: MouseEvent, entryId = '') {
  const anchor = event.currentTarget as HTMLElement;
  if (poolAnchor.value === anchor) { closePoolMenu(); return; }
  poolAnchor.value = anchor;
  poolEntryId.value = entryId;
}
const poolSelection = computed(() => entry(poolEntryId.value));
const poolRecordingBlocked = computed(() => s.value?.paused || !!s.value?.incident || s.value?.bp?.stopped ||
  round.value?.status === 'playing' || poolSelection.value?.mod === 'TB');
const markEntryId = ref('');
const armedAction = ref('');
const actionContext = computed(() => JSON.stringify([s.value?.id, s.value?.action?.id, s.value?.currentRoundId,
  round.value?.status, s.value?.poolChoice, s.value?.scene, s.value?.paused, s.value?.incident?.at]));
watch(actionContext, () => { armedAction.value = ''; closePoolMenu(); });
const hasPoolMarks = computed(() => {
  const state = s.value;
  if (!state) return false;
  return state.pool.some(entry => entry.mod !== 'TB' && poolDisplay(state, entry.id).status !== 'open');
});
const selection = reactive({ edition: 's11', fixtureId: '', poolId: '', leftTeamId: '', rightTeamId: '' });
const resultRound = ref('');
const reason = ref('');
const localError = ref('');
const settings = ref(false);
const startupDialog = ref<HTMLDialogElement>();
const startupChoice = computed(() => snapshot.value?.startupChoice);
watch([startupChoice, startupDialog], ([token, dialog]) => {
  if (token && dialog && !dialog.open) dialog.showModal();
  else if (!token) dialog?.close();
}, { flush: 'post' });
async function chooseStartup(fresh: boolean) {
  if (!startupChoice.value || disabled.value) return;
  const ok = await command(fresh ? 'next-match' : 'continue-match', { startupChoice: startupChoice.value });
  if (ok && fresh) {
    settings.value = true;
    diagnostics.value = false;
    showFeedback('上一场已存档，请选择新比赛。');
  }
}
const initializeDialog = ref<HTMLDialogElement>();
const initializeError = ref('');
const clearRecordsDialog = ref<HTMLDialogElement>();
const clearRecordsError = ref('');
const keepRoomBinding = ref(false);
const canKeepRoomBinding = computed(() => s.value?.auto.profile === 'stable-tourney' && !!s.value.auto.left && !!s.value.auto.right);
let initializeMatchId = '';
const settingMessages = reactive<Record<string, string>>({});
const rollStatus = computed(() => {
  const messages = Object.entries(settingMessages).filter(([key]) => key.startsWith('roll-')).map(([, message]) => message);
  return messages.find(message => message !== '已同步') || messages[0] || '修改后立即生效。';
});
const dirtySettings = new Set<string>();
const settingQueue = new Map<string, number>();
const settingVersions = new Map<string, number>();
const settingContexts = new Map<string, string | null>();
const settingTimers = new Map<string, ReturnType<typeof setTimeout>>();
let drainingSettings = false;
const diagnostics = ref(false);
const adjustments = ref(false);
watch([settings, diagnostics, () => s.value?.warmup], closePoolMenu);
const incidentOpen = ref(false);
const feedback = ref('');
let feedbackTimer: ReturnType<typeof setTimeout>;
function showFeedback(message: string) {
  clearTimeout(feedbackTimer);
  feedback.value = message;
  feedbackTimer = setTimeout(() => { feedback.value = ''; }, 5000);
}
const feedbackKind = ref('success');
const exForm = reactive({ a: 2, b: 2 });
const canEnableEx = computed(() => round.value?.status === 'prepared' && !!entry(round.value.entryId) && entry(round.value.entryId)?.mod !== 'TB');
const exHint = computed(() => entry(round.value?.entryId)?.mod === 'TB' ? '本图为 TB，不能开启 EX。'
  : canEnableEx.value ? '由直播员手动设置；开启／关闭不会自动扣次数。'
  : !round.value || ['recorded', 'void'].includes(round.value.status) ? '先准备本局谱面，再开启 EX。'
  : '本局已开始；可关闭 EX，不能更换开启方。');
const exUnavailable = (team: Team) => s.value?.ex.team !== team && (!canEnableEx.value || !s.value?.ex.remaining[team]);
const correctedScore = reactive({ a: 0, b: 0 });
const incidentReason = ref('');
const incidentLabels = { 'prestart-abort': '比赛未能开始', abort: '比赛开始后中止', 'player-disconnect': '有人尚未结束 · 等待核对', spectator: '观战故障 / Panic', unverified: '观战信号异常 · 原因待核对' };
const plan = reactive({ rows: [] as { team: Team | ''; kind: 'ban' | 'pick' | ''; slot: number }[], verifiedBy: '' });
const canHandleRound = computed(() => !!round.value && ['prepared', 'playing', 'ranking'].includes(round.value.status));
const canContinueRound = computed(() => round.value?.status === 'prepared' || (round.value?.status === 'playing' && live.value?.tosu.status === 'live' &&
  live.value.tosu.data?.tourney?.ipcState === 3 && live.value.tosu.data?.beatmap.id === entry(round.value.entryId)?.beatmapId));
const hasMatchRecords = computed(() => !!s.value?.canUndo);
const roundStatus = { prepared: '已选图 · 比赛尚未开始', playing: '本局进行中', ranking: '结算待记录', recorded: '已计胜', void: '已作废' };
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
const needsResult = (r: Round) => ['playing', 'ranking'].includes(r.status) && r.resultSource !== 'series-correction';
const roundStatusLabel = (r: Round) => r.resultSource === 'series-correction' ? '比分已校正 · 本图已处理' : roundStatus[r.status];
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
    plan.rows = []; plan.verifiedBy = ''; poolEntryId.value = ''; markEntryId.value = '';
    Object.assign(mapForm, { entryId: '', pickedBy: '' });
    settingContexts.clear();
    Object.assign(selection, { edition: catalog.value?.edition || value.match.edition || 's11', fixtureId: '', poolId: '', leftTeamId: '', rightTeamId: '' });
    resultRound.value = ''; reason.value = ''; incidentReason.value = ''; adjustments.value = false;
  }
  const nextMatchKey = JSON.stringify([value.id, value.match.title, value.match.teams, value.match.mode, value.match.source, value.pool]);
  if (nextMatchKey !== matchKey) {
    matchKey = nextMatchKey;
    const fields = { title: value.match.title, a: value.match.teams.a.name, b: value.match.teams.b.name,
      rosterA: formatRosterInput(value.match.teams.a.roster), rosterB: formatRosterInput(value.match.teams.b.roster),
      pool: value.pool.map(e => `${e.label} ${e.beatmapId} ${e.title}`).join('\n'), mode: value.match.mode, source: value.match.source };
    for (const [key, field] of Object.entries(fields)) {
      if (!dirtySettings.has(key)) (form as Record<string, string>)[key] = field;
    }
  }
  const nextRollKey = JSON.stringify([value.id, value.roll]);
  if (rollKey !== nextRollKey) {
    rollKey = nextRollKey;
    for (const field of Object.keys(rollForm) as (keyof typeof rollForm)[]) {
      if (!dirtySettings.has(rollSetting(field))) rollForm[field] = String(value.roll[field] ?? '');
    }
  }
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
  if (!resultRound.value || !value.rounds.some(r => r.id === resultRound.value && needsResult(r))) {
    resultRound.value = value.rounds.find(needsResult)?.id || '';
  }
});
const run = async (type: string, payload: unknown = {}) => {
  localError.value = '';
  const ok = await command(type, payload);
  if (ok) {
    const messages: Record<string, string> = {
      auto: '自动跟随设置已更新。',
      display: `已切到${sceneLabels[normalizeScene(s.value?.scene)]}。`,
      pause: '已展示暂停画面，比赛记录保留。准备好后点击返回原画面。',
      resume: '已返回原画面，暂停期间的赛果请核对后补记。',
      start: '已标记本局开始，正在播出比赛画面。正常结束后自动结算，异常时可先等待。',
      'set-action': '已设置当前队伍与动作。点选谱面，或等待裁判在房间换图。',
      'next-match': keepRoomBinding.value ? '已初始化，保留房间连接并继续跟随；未跟踪的赛果不补记。' : '已初始化，请重新设置比赛。误操作可撤销上一项。',
      'clear-records': '已撤销全部比赛记录；队伍、名单、图池与自动跟随设置保留。',
      undo: `已撤销上一项。当前系列比分 ${series.value.a} : ${series.value.b}，请核对当前图后继续。`,
    };
    const recorded = s.value?.warmup && type === 'display' ? '已手动切换热身播出画面。' : s.value?.history.at(-1)?.message || '';
    const fallback = messages[type] || ({ 'prepare-round': '本图已准备，等待比赛开始。', 'record-result': '已记录本图胜方。', 'correct-result': '已修正本图胜方。', 'retract-result': '已撤回本图计胜，请核对赛果。', 'referee-replay': '已按裁判决定准备原图重赛。', 'resolve-incident': '已继续原局。', 'void-round': '已作废本图，可重新选图。', ranking: '已标记本图结束，成绩尚未计胜。' } as Record<string, string>)[type] || '';
    showFeedback(recorded || fallback || '操作已同步。');
    feedbackKind.value = type === 'undo' ? 'undo' : 'success';
  }
  return ok;
};
function openInitialize() {
  if (!s.value || disabled.value) return;
  initializeMatchId = s.value.id;
  initializeError.value = '';
  keepRoomBinding.value = !!roomScores.value;
  initializeDialog.value?.showModal();
}
function openClearRecords() {
  if (!s.value || disabled.value || !hasMatchRecords.value) return;
  clearRecordsError.value = '';
  clearRecordsDialog.value?.showModal();
}
async function clearAllRecords() {
  if (await run('clear-records')) {
    clearRecordsDialog.value?.close();
    clearRecordsError.value = '';
    feedbackKind.value = 'undo';
  } else clearRecordsError.value = error.value || '未能撤销，请稍后重试。';
}
async function initializeMatch() {
  if (s.value?.id !== initializeMatchId) {
    initializeError.value = '比赛已切换，请关闭后重新操作。';
    return;
  }
  if (await run('next-match', { keepRoomBinding: keepRoomBinding.value })) {
    initializeDialog.value?.close();
    settings.value = !keepRoomBinding.value; diagnostics.value = false;
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
  if (key === 'round') settingContexts.set(key, s.value?.currentRoundId ?? null);
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
          type = 'set-series'; payload = seriesPayload(scoreTeam, value);
        } else if (key === 'auto') {
          type = 'auto'; payload = { bp: autoForm.bp, scenes: autoForm.scenes, results: autoForm.results };
        } else if (key === 'round') {
          const value = mapForm;
          if (!value.entryId || (entry(value.entryId)?.mod !== 'TB' && !value.pickedBy)) throw new Error('请选择谱面与选图队伍，完整后自动生效');
          if (settingContexts.get(key) !== (s.value?.currentRoundId ?? null)) throw new Error('本局已切换，请在最新轮次重新修改');
          type = 'adjust-round';
          payload = { ...value, ...(entry(value.entryId)?.mod === 'TB' ? { pickedBy: null } : {}), ifCurrentRoundId: settingContexts.get(key) };
        } else if (key === 'action') {
          if (!actionForm.team || !actionForm.kind || (actionForm.kind === 'ban' && ![0, 1].includes(actionForm.slot))) throw new Error('请选择队伍、动作及 Ban 槽，完整后自动生效');
          type = 'set-action'; payload = { action: { ...actionForm } };
        } else if (key.startsWith('ex-')) {
          const team = key === 'ex-a' ? 'a' : key === 'ex-b' ? 'b' : null;
          if (team && (!Number.isInteger(exForm[team]) || exForm[team] < 0 || exForm[team] > 2)) throw new Error('请输入 0 到 2 之间的整数，空白不会记为 0');
          type = 'ex'; payload = { team: s.value!.ex.team,
            remaining: { ...s.value!.ex.remaining, ...(team ? { [team]: exForm[team] } : {}) } };
        } else if (key.startsWith('roll-')) {
          const field = key.slice(5) as keyof typeof rollForm;
          const raw = rollForm[field];
          type = 'set-roll';
          payload = { [field]: raw === '' ? null : field === 'a' || field === 'b' ? Number(raw) : raw };
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
          payload = { field: 'roster', team, value: parseRosterInput(form[key]) };
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
            if (key.startsWith('roll-') && s.value) {
              const field = key.slice(5) as keyof typeof rollForm;
              rollForm[field] = String(s.value.roll[field] ?? '');
            }
            if (key === 'auto' && s.value) Object.assign(autoForm, s.value.auto);
          }
        }
      } catch (e) { if (settingVersions.get(key) === version) settingMessages[key] = (e as Error).message; }
    }
  } finally { drainingSettings = false; }
}
watch([busy, connection], () => { void drainSettings(); });

function recordResult(winner: Team | null) {
  return run('record-result', { roundId: resultRound.value, winner, keepDisplay: true,
    reviewReason: s.value?.incident?.roundId === resultRound.value ? incidentNote('直播员已核对实际成绩，人工记录胜方') : undefined });
}
const markPool = (status: 'open' | 'banned' | 'picked', team: Team | null) => run('map-mark', { entryId: markEntryId.value, status, team });
const clearAllPoolMarks = () => run('clear-pool-marks');
const banMessages = reactive<Record<string, string>>({});
const banSlotValue = (team: Team, slot: number) => s.value?.bans[team][slot]
  ? `map:${s.value.bans[team][slot]}` : s.value?.emptyBans?.[team][slot] ? 'empty' : 'unknown';
const banOptions = (team: Team, slot: number) => (s.value?.pool || []).filter(candidate => {
  const state = s.value!;
  if (candidate.id === state.bans[team][slot]) return true;
  return candidate.mod !== 'TB' && !state.rounds.some(r => r.entryId === candidate.id && r.status !== 'void') &&
    !(['a', 'b'] as const).some(side => state.bans[side].some((id, index) => id === candidate.id && (side !== team || index !== slot))) &&
    (!['HD', 'HR', 'DT'].includes(candidate.mod) || !state.bans[team].some((id, index) => index !== slot && entry(id)?.mod === candidate.mod));
});
async function correctBan(team: Team, slot: number, value: string | number) {
  const key = `${team}:${slot}`;
  banMessages[key] = '正在同步…';
  const selected = String(value);
  const ok = await run('correct-ban', { team, slot, entryId: selected.startsWith('map:') ? selected.slice(4) : null, empty: selected === 'empty' });
  banMessages[key] = ok ? '已同步，可撤销上一项。' : error.value || '未同步，请重新选择。';
}
async function choosePoolAction(team: Team, kind: 'ban' | 'pick') {
  const anchor = poolAnchor.value;
  if (poolEntryId.value) {
    if (await run('choose-pool-map', { entryId: poolEntryId.value, team, kind })) {
      closePoolMenu();
      anchor?.focus({ preventScroll: true });
    }
    return;
  }
  const previousRound = s.value?.currentRoundId;
  if (await run('select-bp-action', { team, kind, applyRoomMap: true })) {
    if (s.value?.currentRoundId === previousRound && s.value?.poolChoice?.team === team && s.value.poolChoice.kind === kind) {
      armedAction.value = actionContext.value;
    }
    closePoolMenu();
    anchor?.focus({ preventScroll: true });
  }
}
async function choosePoolMap(entryId: string, event: MouseEvent) {
  const choice = s.value?.poolChoice;
  if (armedAction.value === actionContext.value && choice && entry(entryId)?.mod !== 'TB') {
    if (await run('choose-pool-map', { entryId, ...choice })) armedAction.value = '';
  } else openPoolMenu(event, entryId);
}
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
  if (entry(id)?.mod === 'TB' && mark.status !== 'open') return mark.status === 'used' ? '决胜图 · 已结束' : '决胜图 · 已准备';
  return mark.team && mark.status !== 'open' ? `${names.value[mark.team]} ${mark.status === 'banned' ? 'Ban' : mark.status === 'used' ? '已结束' : 'Pick'}` : '';
}
const nextStep = computed(() => s.value?.warmup ? '热身仅影响播出显示，可随时手动关闭；比赛记录与房间观测继续。' : operatorNextStep(s.value, panel.value, connection.value, !!roomScores.value, target.value, poolEntryId.value, liveRoom(snapshot.value, connection.value)?.ipcState, roomReview.value));
const bpPhases: { id: BpPhase; label: string }[] = [
  { id: 'ban1', label: '第一轮 Ban' },
  { id: 'pick1', label: '第一轮 Pick' },
  { id: 'ban2', label: '第二轮 Ban' },
  { id: 'pick2', label: '第二轮 Pick' },
];
const availableBpPhases = computed(() => bpPhases.filter(phase => s.value?.bp?.phases?.includes(phase.id) ?? true));
const bpPhase = computed(() => s.value?.bp?.phase || null);
const bpPhaseDisabled = computed(() => disabled.value || !s.value || !!s.value.warmup || s.value.paused || !!s.value.incident ||
  !s.value.bp || s.value.bp.stopped || !!s.value.bp.waiting || (!['roll', 'manual'].includes(s.value.bp.mode) && !s.value.bp.canStart));
async function jumpBpPhase(phase: BpPhase) {
  if (await run('jump-bp-phase', { phase })) {
    poolEntryId.value = '';
  }
}
const gameStatus = computed(() => live.value?.sources?.tosu === 'simulated' && live.value?.tosu.status === 'live' ? '游戏模拟信号已连接' : ({ live: '游戏数据已连接', stale: '游戏数据已过期', 'invalid-data': '游戏数据暂不可用', error: '游戏未连接 · 请检查连接设置', disconnected: '游戏连接中断 · 正在重连', connecting: '正在连接游戏', stopped: '游戏数据已停止', idle: '尚未接入游戏数据' }[live.value?.tosu.status || 'idle'] || '等待游戏数据'));
const latestResult = computed(() => [...(s.value?.rounds || [])].reverse().find(r => r.status === 'recorded'));
const seriesPayload = (team: Team, value: number) => ({ ...s.value!.series, [team]: value, reason: note('直播员核对后直接校正系列比分') });
const display = (scene: string) => run('display', { scene });
const onKey = (event: KeyboardEvent) => {
  if (document.querySelector('dialog[open], [role="listbox"]') || event.ctrlKey || event.metaKey || !event.altKey || event.defaultPrevented || disabled.value) return;
  const element = event.target as HTMLElement;
  if (element?.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(element?.tagName || '')) return;
  const shortcuts: Record<string, string> = { '1': 'waiting', '2': 'roll', '3': 'mappool', '4': 'playing', '5': 'victory' };
  const key = event.code.startsWith('Digit') ? event.code.slice(5) : event.key;
  if (shortcuts[key]) { event.preventDefault(); void display(shortcuts[key]!); }
};
onMounted(() => { window.addEventListener('message', previewReady); previewHeartbeat = setInterval(sharePreview, 5000); pauseClockTimer = setInterval(() => { if (pauseTimer.value || resumeAt.value || winnerPending.value) pauseClockNow.value = Date.now(); }, 250); document.body.classList.add('is-control'); document.title = 'OCLR · 直播员控制台'; window.addEventListener('keydown', onKey); });
onUnmounted(() => { window.removeEventListener('message', previewReady); clearTimeout(feedbackTimer); clearInterval(previewHeartbeat); clearInterval(pauseClockTimer); for (const timer of settingTimers.values()) clearTimeout(timer); settingQueue.clear(); document.body.classList.remove('is-control'); window.removeEventListener('keydown', onKey); });
const operationTime = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
</script>

<template>
  <main class="operator" :class="{ 'motion-ready': motionReady }">
    <header class="operator-header">
      <div class="operator-brand"><span class="operator-kicker">OCLR {{ s?.match.edition?.toUpperCase() || 'S11' }}</span><h1>直播控制台</h1></div>
      <div class="operator-match"><span>{{ names.a }}</span><strong>{{ s?.warmup ? 'Warm-up' : `${series.a} : ${series.b}` }}</strong><span>{{ names.b }}</span></div>
      <div class="operator-edition">{{ s?.match.title }}<br>{{ stageSummary }}</div>
    </header>
    <nav class="operator-tabs" aria-label="控制台页面">
      <button :aria-pressed="!settings && !diagnostics" @click="settings = false; diagnostics = false">比赛现场</button>
      <button :aria-pressed="settings" @click="settings = true; diagnostics = false">开播前设置</button>

      <a href="/overlay" target="_blank" rel="noopener">打开观众画面 ↗</a>
    </nav>
    <p v-if="!s" class="operator-empty">正在连接本场比赛。连接恢复后会自动显示原有记录。</p>
    <template v-if="s">
      <section v-if="!settings && !diagnostics" class="operator-toolbar" aria-label="随时可用的比赛操作">
        <span class="operator-follow-status">{{ connection !== 'synced' ? '控制台连接中断' : s.warmup ? 'Warm-up · 热身显示' : roomReview ? '房间用图待核对' : s.incident ? '等待核对 · 暂不加分' : s.paused ? '播出已暂停' : !(s.auto.bp || s.auto.scenes || s.auto.results) ? '自动跟随已关闭' : live?.tosu.status !== 'live' ? '等待游戏连接' : !liveRoom(snapshot, connection) ? '等待比赛房间' : round?.resultSource === 'series-correction' ? '系列比分已确认 · 等待下一图': s.sceneOverride ? '保持所选画面 · 数据跟随中' : roomScores ? live?.tosu.data?.tourney?.ipcState === 4 ? '结算成绩同步中' : '比赛进行中' : round?.status === 'prepared' ? '等待比赛开始' : '等待现场操作' }}</span>
        <button v-if="!s.paused" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('pause', { kind: 'normal' })">暂停播出</button>
        <button v-else class="operator-primary" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('resume')">返回{{ sceneLabels[s.returnScene as Scene] || '原画面' }}</button>
        <button v-if="!s.paused" :disabled="disabled" @click="run('pause', { kind: 'tactical' })">战术暂停</button>
        <button :disabled="disabled || !s.canUndo" :data-unavailable="connection !== 'synced' || !s.canUndo" @click="run('undo')">撤销上一项</button>
        <button v-if="round && !s.warmup" @click="showIncidents()">处理异常</button><button v-if="!s.warmup" @click="showAdjustments">比赛纠错</button>
      </section>
      <div class="operator-notice" aria-label="操作反馈" :aria-busy="busy">
          <p v-show="error || localError" role="alert" class="operator-error">{{ localError || error }}</p>
          <p v-show="!error && !localError" class="operator-feedback" :class="{ 'operator-feedback--undo': feedbackKind === 'undo' }" role="status">{{ feedback }}</p>
      </div>
      <section v-show="settings" class="operator-setup" aria-label="本场设置">
        <div class="operator-section-head"><h2>本场设置</h2><span>修改后自动同步，无需保存；已有比赛记录保留</span></div>
        <StreamingAccess v-if="snapshot" :snapshot="snapshot" :disabled="disabled" />
        <div class="setup-meta">
          <label>比赛标题<input v-model="form.title" aria-label="比赛标题" maxlength="160" @input="scheduleSetting('title')" @blur="dirtySettings.has('title') && scheduleSetting('title', true)"><span class="operator-hint" aria-live="polite">{{ settingMessages.title }}</span></label>
          <p v-if="exhibition">阶段：{{ stageSummary }}</p>
          <label v-else>阶段<ControlSelect :value="s.match.stage" :disabled="disabled" :data-unavailable="connection !== 'synced'" aria-describedby="stage-hint" @change="changeStage"><option value="group">小组赛 · BO11</option><option value="elimination">淘汰赛 · BO11</option><option value="final">决赛 · BO13</option></ControlSelect><span id="stage-hint" class="operator-hint">选择后立即同步播出画面</span></label>
          <label>常规人数<ControlSelect v-model="form.mode" aria-label="常规人数" @change="scheduleSetting('mode', true)"><option v-if="exhibition">1v1</option><option v-if="exhibition">2v2</option><option>3v3</option><option>4v4</option></ControlSelect><span class="operator-hint" aria-live="polite">{{ settingMessages.mode }}</span></label>
          <label>游戏源比例<ControlSelect v-model="form.source" aria-label="游戏源比例" @change="scheduleSetting('source', true)"><option value="4x3">4:3</option><option value="16x9">16:9</option></ControlSelect><span class="operator-hint" aria-live="polite">{{ settingMessages.source }}</span></label>
        </div>
        <details v-if="!exhibition" class="operator-import"><summary>从 OCLR 已发布资料选择</summary>
          <div class="operator-inline"><label>赛季 slug<input v-model="selection.edition" maxlength="80" @input="scheduleSetting('edition')" @blur="dirtySettings.has('edition') && scheduleSetting('edition', true)"><span class="operator-hint" aria-live="polite">{{ settingMessages.edition }}</span></label></div>
          <p>只读已发布资料；空集合保持为空，不自动填入其他赛季。</p>
          <p v-if="catalog?.kind === 'historical_archive'">{{ catalog.edition?.toUpperCase() }} 历史归档 · {{ catalog.capturedOn }} · 历史比分仅作参考，本地播出从零开始；图池未绑定的历史场次须明确选择图池。</p>
          <p v-for="warning in catalog?.warnings" :key="warning">{{ warning }}</p>
          <div class="setup-meta">
            <label>场次<ControlSelect v-model="selection.fixtureId" @change="fixtureSelected"><option value="">未选择 / 人工对阵</option><option v-for="f in catalog?.fixtures.filter(f => !f.exhibition)" :key="f.id" :value="f.id">{{ f.roundName }} {{ f.label }}</option></ControlSelect><span v-if="catalog?.fixtures.some(f => f.exhibition)" class="operator-hint">表演赛请从上方「OCLR 直播任务」导入。</span></label>
            <label>图池<ControlSelect v-model="selection.poolId" @change="scheduleSetting('import', true)"><option value="">请选择</option><option v-for="p in catalog?.pools" :key="p.id" :value="p.id">{{ p.name }}</option></ControlSelect></label>
            <label>左队<ControlSelect v-model="selection.leftTeamId" @change="scheduleSetting('import', true)"><option value="">请选择</option><option v-for="t in catalog?.teams" :key="t.id!" :value="t.id">{{ t.name }}</option></ControlSelect></label>
            <label>右队<ControlSelect v-model="selection.rightTeamId" @change="scheduleSetting('import', true)"><option value="">请选择</option><option v-for="t in catalog?.teams" :key="t.id!" :value="t.id">{{ t.name }}</option></ControlSelect></label>
          </div><p role="status">{{ settingMessages.import || '选择完整资料后立即使用；不改变已有比赛进度。' }}</p>
        </details>
        <details><summary>手动编辑队伍、名单与图池</summary>
          <div class="setup-teams">
            <div><label>左队名称<input v-model="form.a" :readonly="automaticTeamNames" aria-label="左队名称" maxlength="80" required @input="scheduleSetting('a')" @blur="dirtySettings.has('a') && scheduleSetting('a', true)"><span class="operator-hint" aria-live="polite">{{ settingMessages.a || (automaticTeamNames ? '从 tosu 房间左队自动读取' : '') }}</span></label><label>左队上场名单 · 每行「用户名,UID」<textarea v-model="form.rosterA" aria-label="左队上场名单 · 每行「用户名,UID」" @input="scheduleSetting('rosterA')" @blur="dirtySettings.has('rosterA') && scheduleSetting('rosterA', true)" rows="4" placeholder="Alice,12345（UID 可省略）"></textarea><span class="operator-hint" aria-live="polite">{{ settingMessages.rosterA || '用户名可省略；只有 UID 时用 UID 作名称' }}</span></label></div>
            <div><label>右队名称<input v-model="form.b" :readonly="automaticTeamNames" aria-label="右队名称" maxlength="80" required @input="scheduleSetting('b')" @blur="dirtySettings.has('b') && scheduleSetting('b', true)"><span class="operator-hint" aria-live="polite">{{ settingMessages.b || (automaticTeamNames ? '从 tosu 房间右队自动读取' : '') }}</span></label><label>右队上场名单 · 每行「用户名,UID」<textarea v-model="form.rosterB" aria-label="右队上场名单 · 每行「用户名,UID」" @input="scheduleSetting('rosterB')" @blur="dirtySettings.has('rosterB') && scheduleSetting('rosterB', true)" rows="4" placeholder="Alice,12345（UID 可省略）"></textarea><span class="operator-hint" aria-live="polite">{{ settingMessages.rosterB || '用户名可省略；只有 UID 时用 UID 作名称' }}</span></label></div>
            <label>本场图池 · 每行「标签 谱面ID 标题」<textarea v-model="form.pool" aria-label="本场图池 · 每行「标签 谱面ID 标题」" @input="scheduleSetting('pool')" @blur="dirtySettings.has('pool') && scheduleSetting('pool', true)" rows="7" placeholder="HD2 谱面ID 标题" spellcheck="false"></textarea><span class="operator-hint" aria-live="polite">{{ settingMessages.pool }}</span></label>
          </div><p>文字输入停顿后自动同步；无效内容保留在输入框并显示原因，播出继续使用上一次有效设置。名单与图池修改会标为人工资料。</p>
        </details>
          <details class="operator-follow"><summary>房间连接与自动跟随 <span>{{ s.auto.bp || s.auto.scenes || s.auto.results ? '已启用' : '关闭' }}</span></summary>
            <p>房间左右队名直接读取 tosu，收到有效赛事数据后自动跟随，无需手动填写或确认。</p>
            <p>当前读数：{{ live?.tosu.data?.tourney?.teams.left || '—' }} / {{ live?.tosu.data?.tourney?.teams.right || '—' }} · {{ gameStatus }}</p>
            <label class="operator-check"><input v-model="autoForm.bp" type="checkbox" @change="scheduleSetting('auto', true)">按当前 BP 动作自动 Ban / Pick</label>
            <label class="operator-check"><input v-model="autoForm.scenes" type="checkbox" @change="scheduleSetting('auto', true)">换图 / 比赛开始 / 结算时自动切换画面</label>
            <label class="operator-check"><input v-model="autoForm.results" type="checkbox" @change="scheduleSetting('auto', true)">正常结算按最终队分自动加赢图</label><p role="status">{{ settingMessages.auto || '自动化默认开启；资料不足时等待，恢复后自动建立基线。明确暂停保留，普通人工修正立即生效。' }}</p>
          </details>
        <details class="operator-follow"><summary>可选：后续 BP 顺序</summary><p>只用于需要自动跟随已知顺序的比赛。可直接从当前局开始，之前未跟踪的 Ban／Pick 无需补录；这里仅修改后续动作。</p>
          <div v-for="(row, i) in plan.rows" :key="i" class="operator-plan-row"><label>第 {{ i + 1 }} 项队伍<ControlSelect v-model="row.team" @change="scheduleSetting('plan', true)"><option value="">请选择</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label><label>动作<ControlSelect v-model="row.kind" @change="scheduleSetting('plan', true)"><option value="">请选择</option><option value="ban">Ban</option><option value="pick">Pick</option></ControlSelect></label><label v-if="row.kind === 'ban'">Ban 槽<ControlSelect v-model="row.slot" @change="scheduleSetting('plan', true)"><option :value="-1">请选择</option><option :value="0">Ban 1</option><option :value="1">Ban 2</option></ControlSelect></label><button @click="plan.rows.splice(i, 1); scheduleSetting('plan', true)">删除第 {{ i + 1 }} 项</button></div>
          <div class="operator-inline"><button :disabled="plan.rows.length >= 40" @click="plan.rows.push({ team: '', kind: '', slot: -1 }); scheduleSetting('plan', true)">添加一项</button><button @click="plan.rows = s.queue.map(a => ({ team: a.team, kind: a.kind, slot: a.slot ?? -1 }))">载入现有后续动作</button></div><label>核实来源 / 负责人（可选）<input v-model="plan.verifiedBy" maxlength="160" placeholder="可补充本场顺序的来源" @input="scheduleSetting('plan')" @blur="dirtySettings.has('plan') && scheduleSetting('plan', true)"></label><p role="status">{{ settingMessages.plan || '队伍与动作选全后自动生效；核实来源可选。' }}</p>
        </details>
        <details class="desk-management"><summary>管理比赛记录</summary><div class="operator-inline">
          <button :disabled="disabled || !hasMatchRecords" :data-unavailable="connection !== 'synced' || !hasMatchRecords" @click="openClearRecords">全部撤销</button>
        <button class="operator-reset" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="openInitialize">初始化</button>
        </div></details>
        <button @click="diagnostics = true; settings = false">查看维护详情</button>
      </section>

      <section v-if="diagnostics" class="operator-records" aria-label="维护详情">
        <h2>维护详情</h2><p>连接、原始读数与存储状态供维护人员检查。比赛中无需操作这些字段。</p>
        <dl class="operator-diagnostics"><dt>控制台同步</dt><dd>{{ connection }} · v{{ s.version }}</dd><dt>游戏数据</dt><dd>{{ live?.tosu.status }} · {{ live?.tosu.updatedAt || '尚无有效数据' }}</dd><dt>赛事资料</dt><dd>{{ live?.oclr.status }} · {{ live?.oclr.error || '—' }}</dd><dt>存储</dt><dd>{{ snapshot?.persistence }}</dd><dt>房间 / IPC</dt><dd>{{ live?.tosu.data?.tourney?.teams.left || '—' }} / {{ live?.tosu.data?.tourney?.teams.right || '—' }} · {{ live?.tosu.data?.tourney?.ipcState ?? '—' }}</dd><dt>当前谱面</dt><dd>{{ live?.tosu.data?.beatmap.id ?? '—' }}</dd><dt>自动观察器</dt><dd>{{ live?.note }}</dd></dl>
        <p>未完成真实 osu!tourney / tosu / OBS 时序联调。完整旧快照仍可能被提前计胜；分数一致或稳定都不能证明所有人已结束。日志录制与模拟器由开发维护人员使用。</p>
      </section>
      <template v-if="!settings && !diagnostics">

        <div class="operator-workspace">
          <section class="operator-actions" aria-label="当前画面管理">
            <section class="operator-situation" aria-label="当前步骤"><div><span class="operator-kicker">当前步骤 · {{ sceneLabels[s.scene as Scene] }}</span><h2>{{ panelHeading }}</h2><p role="status" aria-live="polite">{{ nextStep }}</p>
              <template v-if="roomReview?.entryId">
                <button v-if="roomReview.stage === 'ready' || roomReview.stage === 'finished'" class="operator-primary" :disabled="disabled" @click="run('confirm-room-map', { kind: roomReview.kind, stage: roomReview.stage, entryId: roomReview.entryId, ifCurrentRoundId: roomReview.roundId })">{{ roomReview.stage === 'finished' ? '确认 ' + roomReview.roomLabel + ' 已结束，核对赛果' : roomReview.kind === 'tb' ? '确认准备决胜图 ' + roomReview.roomLabel : '改为房间当前谱面 ' + roomReview.roomLabel }}</button>
                <button v-if="tbAlreadyPlayed && roomReview.stage === 'finished' && [1, 2].includes(live?.tosu.data?.tourney?.ipcState ?? -1)" :disabled="disabled" @click="prepareTiebreaker(true)">裁判要求重打，重新准备 TB</button>
              </template>
              <p v-if="!s.warmup && !roomReview && round && scorePanel" class="operator-round-context">当前图 {{ entry(round.entryId)?.label }} · {{ roundStatusLabel(round) }}</p></div><span :class="{ 'status-good': connection === 'synced' }">{{ connection === 'synced' ? '画面已同步' : '等待重连' }}<br>{{ gameStatus }}</span></section>
            <div v-if="s.warmup" class="operator-action-stack">
              <h3>热身实时队分</h3>
              <div class="operator-two"><p>{{ names.a }}<br><strong>{{ teamScore(roomScores?.left) }}</strong></p><p>{{ names.b }}<br><strong>{{ teamScore(roomScores?.right) }}</strong></p></div>
              <p>热身仅影响显示，比赛记录与房间观测继续。可在观众预览下方切换画面。</p>
            </div>
            <div v-else-if="panel === 'waiting'" class="operator-action-stack">
              <div class="operator-two"><div v-for="team in (['a', 'b'] as const)" :key="team" class="operator-team-status" :data-team="team"><h3>{{ names[team] }}</h3><label class="operator-check"><input type="checkbox" :checked="s.arrived[team]" :disabled="disabled" :data-unavailable="connection !== 'synced'" @change="run('arrival', { team, arrived: !s.arrived[team], ready: false })">已到场</label><label class="operator-check"><input type="checkbox" :checked="s.ready[team]" :disabled="disabled || !s.arrived[team]" :data-unavailable="connection !== 'synced' || !s.arrived[team]" @change="run('arrival', { team, arrived: true, ready: !s.ready[team] })">已就绪</label></div></div>
              <button class="operator-primary" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="display('roll')">开始 Roll →</button>
            </div>
            <div v-else-if="panel === 'roll'" class="operator-action-stack">
              <div class="operator-two"><label>{{ names.a }} Roll<input v-model="rollForm.a" type="number" min="0" step="1" @input="scheduleSetting('roll-a')" @blur="dirtySettings.has('roll-a') && scheduleSetting('roll-a', true)"></label><label>{{ names.b }} Roll<input v-model="rollForm.b" type="number" min="0" step="1" @input="scheduleSetting('roll-b')" @blur="dirtySettings.has('roll-b') && scheduleSetting('roll-b', true)"></label></div>
              <label v-for="[field, label] in rollFields" :key="field">{{ label }}<ControlSelect v-model="rollForm[field]" @change="scheduleSetting(rollSetting(field), true)"><option value="">未确认</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label>
              <p role="status">{{ rollStatus }}</p>
              <button v-if="s.roll.pickFirst && (exhibition || s.roll.banFirst)" class="operator-primary" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('bp')">{{ exhibition ? '进入图池' : '进入图池 / BP' }} →</button>
              <p v-if="exhibition" class="operator-hint">如裁判安排 Ban，在图池点击相应队伍的 Ban。</p>
            </div>
            <div v-else-if="panel === 'mappool'" class="operator-action-stack">
              <div class="operator-section-head"><h3>本场图池</h3>
                <button :disabled="disabled || poolRecordingBlocked && !poolSelection" :aria-expanded="!!poolAnchor && !poolSelection" @click="openPoolMenu($event)">先选动作</button>
              </div>
              <p v-if="armedAction && s.poolChoice && !s.bp?.stopped" role="status">{{ names[s.poolChoice.team] }} {{ s.poolChoice.kind === 'ban' ? 'Ban' : 'Pick' }} · 请选择谱面</p>
              <button class="operator-tiebreaker" :aria-pressed="!!tb?.active" :disabled="disabled || tbAlreadyPlayed || !tb?.canPrepare || tbEntries.length !== 1 || !!tb.active" :title="tbButtonHint" @click="prepareTiebreaker()">TieBreaker · 准备决胜图</button>
              <div class="operator-pool" aria-label="本场图池"><button v-for="e in s.pool" :key="e.id" :data-mod="e.mod" :style="modColorStyle(e.mod)" :data-team="poolDisplay(s, e.id).team" :data-map-state="poolDisplay(s, e.id).status" :aria-expanded="!!poolAnchor && poolEntryId === e.id" :aria-controls="poolEntryId === e.id ? 'map-actions' : undefined" :title="e.title || `谱面 ${e.beatmapId}`" :disabled="disabled" @click="choosePoolMap(e.id, $event)"><strong>{{ e.label }}</strong><span>{{ e.title || `谱面 ${e.beatmapId}` }}</span><small v-if="poolState(e.id)">{{ poolState(e.id) }}</small></button></div>
              <MapActionPopover v-if="poolAnchor" :anchor="poolAnchor" @dismiss="closePoolMenu">
                <strong id="map-title">{{ poolSelection ? poolSelection.label + ' · ' + (poolSelection.title || poolSelection.beatmapId) : '选择本次 BP 动作' }}</strong>
                <template v-if="poolSelection?.mod === 'TB'">
                  <p>{{ tbButtonHint }}</p>
                  <button :disabled="disabled || tbAlreadyPlayed || !tb?.canPrepare || tbEntries.length !== 1 || !!tb.active" @click="prepareTiebreaker(); closePoolMenu()">准备决胜图</button>
                </template>
                <template v-else>
                  <div class="operator-bp-buttons"><template v-for="team in (['a','b'] as const)" :key="team">
                    <button v-for="kind in (['ban','pick'] as const)" :key="kind" :data-team="team" :disabled="disabled || poolRecordingBlocked" @click="choosePoolAction(team, kind)">{{ names[team] }} {{ kind === 'ban' ? 'Ban' : 'Pick' }}</button>
                  </template></div>
                  <p v-if="poolRecordingBlocked">当前无法记录 Ban/Pick。播出标记可在图池纠错中修改。</p>
                </template>
                <p v-if="error" role="alert">{{ error }}</p>
              </MapActionPopover>
              <p v-if="!s.pool.length">还没有图池，请在本场设置选择真实资料。</p>
              <details><summary>纠正图池记录与播出标记</summary>
              <div v-if="s.bp" class="operator-bp-phases desk-phase-jump" role="group" aria-label="跳转禁选阶段">
                <strong>跳到阶段</strong>
                <button v-for="(phase, index) in availableBpPhases" :key="phase.id" type="button"
                  :aria-pressed="bpPhase === phase.id"
                  :disabled="bpPhaseDisabled || index < availableBpPhases.findIndex(item => item.id === bpPhase)"
                  @click="jumpBpPhase(phase.id)">{{ phase.label }}</button>
              </div>
                <p>{{ s.bp?.waiting || (bpPhaseDisabled ? '请先确认先手或当前 BP 动作，并结束暂停或异常处理。' : '跳转会重建后续顺序。之前的阶段可用撤销返回；确认空 Ban 请单独记录。') }}</p>
                <label>仅修改播出标记<ControlSelect v-model="markEntryId"><option value="">选择谱面</option><option v-for="e in s.pool.filter(e => e.mod !== 'TB')" :key="e.id" :value="e.id">{{ e.label }}</option></ControlSelect></label>
                <div class="operator-inline"><template v-for="team in (['a','b'] as const)" :key="team"><button v-for="status in (['banned','picked'] as const)" :key="status" :disabled="disabled || !markEntryId" @click="markPool(status, team)">标记 {{ names[team] }} {{ status === 'banned' ? 'Ban' : 'Pick' }}</button></template>
                <button :disabled="disabled || !markEntryId" @click="markPool('open', null)">清除该图标记</button></div>
              <button v-if="lastBp?.canRetract" :disabled="disabled" @click="run('retract-bp', { actionId: lastBp.actionId, selectionId: lastBp.selectionId })">撤回本次 Ban / Pick</button>
                <button v-if="s.bp?.canApply && s.action?.kind === 'ban' && s.poolChoice?.kind === 'ban' && s.poolChoice.team === s.action.team" :disabled="disabled" @click="run('skip-ban', { actionId: s.action.id, reason: note('已核实本次空 Ban') })">{{ names[s.action.team] }} 空 Ban（已确认）</button>
                <button :disabled="disabled || !hasPoolMarks" @click="clearAllPoolMarks">清除所有播出标记</button>
              </details>
            </div>
            <div v-else-if="scorePanel" class="operator-action-stack">
              <p v-if="exhibition?.series?.type === 'fixed_maps'">已完成 {{ exhibitionProgress?.played }} / {{ exhibition.series.count }} 图（含已记录的平局）。</p>
              <p v-if="exhibition && !exhibition.autoResults">本场请按裁判核对的结果人工记分。</p>
              <section class="operator-series-edit" aria-label="本图实时队分"><h3>{{ live?.tosu.data?.tourney?.ipcState === 4 ? '本图结算总分' : '本图实时队分' }}</h3><div class="operator-two"><p>{{ names.a }}<br><strong>{{ teamScore(roomScores?.left) }}</strong></p><p>{{ names.b }}<br><strong>{{ teamScore(roomScores?.right) }}</strong></p></div><p aria-live="polite">{{ roomScoreHint }}</p></section>
              <details class="operator-series-edit"><summary>校正系列比分</summary><div class="operator-two"><label v-for="team in (['a', 'b'] as const)" :key="team">{{ names[team] }} 赢图<input v-model.number="correctedScore[team]" :aria-label="`${names[team]} 赢图`" :aria-describedby="`series-${team}-status`" type="number" min="0" :max="target" step="1" required @input="scheduleSetting(`series-${team}`, true)"><span :id="`series-${team}-status`" class="operator-hint" aria-live="polite">{{ settingMessages[`series-${team}`] }}</span></label></div><p>修改即生效，作为系列比分校正保留；裁判要求重赛也不会自动撤回。若裁判判本图胜方，请使用下方“记本图胜”，重赛会撤回该图贡献。</p></details>
              <button v-if="round?.status === 'prepared' && !roomReview" :disabled="disabled || !!s.incident || !!s.action" :data-unavailable="connection !== 'synced' || !!s.incident || !!s.action" @click="run('start')">手动标记本局已开始</button>
              <details v-if="round?.status === 'playing'"><summary>本图已结束，游戏仍显示进行中</summary><button :disabled="disabled || s.paused" @click="run('finish-round', { roundId: round.id })">本图已结束，继续 BP（暂不计胜）</button></details>
              <details v-if="resultRound" id="manual-result" class="operator-result" :key="resultRound + round?.status" :open="s.rounds.find(r => r.id === resultRound)?.status === 'ranking'"><summary>核对后人工记录赛果</summary>
                <label>本图<ControlSelect v-model="resultRound"><option v-for="r in s.rounds.filter(needsResult)" :key="r.id" :value="r.id">{{ entry(r.entryId)?.label }} · {{ roundStatus[r.status] }}{{ r.id !== s.currentRoundId ? '（上一局）' : '' }}</option></ControlSelect></label>
                <div class="operator-two"><button v-for="team in (['a', 'b'] as const)" :key="team" :disabled="disabled || !resultRound" :data-unavailable="connection !== 'synced' || !resultRound" @click="recordResult(team)">记{{ recordingPrevious ? '上一局' : '本图' }} {{ names[team] }} 胜</button></div>
                <button v-if="resultMayDraw" :disabled="disabled" @click="recordResult(null)">记录本图平局</button><p>按实际赛果记录，计错可撤回或修正。</p>
              </details>
              <details v-if="latestResult" class="operator-latest-result">
                <summary>{{ entry(latestResult.entryId)?.label }} 已记 {{ latestResult.winner ? names[latestResult.winner] + ' 胜' : '平局' }} · 修正（备用）</summary>
                <p>系列比分可在上方直接修改；这里只在需要修正单图记录时使用。{{ latestResult.resultSource === 'tosu' ? '自动记录；若成绩仍有变化会转为等待核对。发现胜方错误可立即修正。' : '人工记录优先，旧数据不会覆盖。' }}</p>
                <div class="operator-inline">
                  <template v-for="team in (['a', 'b'] as const)" :key="team"><button v-if="latestResult.winner !== team" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('correct-result', { roundId: latestResult.id, winner: team, reason: '直播员核对后修正本图赛果' })">改为 {{ names[team] }} 胜</button></template>
                  <button v-if="latestResult.winner && exhibition?.tiedMapPolicy === 'count_as_draw'" :disabled="disabled" @click="run('correct-result', { roundId: latestResult.id, winner: null, reason: '直播员核对后修正本图为平局' })">改为平局</button>
                  <button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('retract-result', { roundId: latestResult.id, reason: '直播员撤回本图赛果，等待核对' })">撤回本图赛果</button>
                </div>
              </details>
              <template v-for="team in (['a', 'b'] as const)" :key="team"><button v-if="canShowWinner(team)" :disabled="disabled || !!s.incident" :data-unavailable="connection !== 'synced' || !!s.incident" @click="run('winner', { team })">展示 {{ names[team] }} Winner</button></template>
              <button v-if="exhibitionProgress?.draw" :disabled="disabled || !!s.incident" @click="run('winner', { team: null })">展示表演赛平局</button>
            </div>
            <div v-else-if="panel === 'victory'" class="operator-action-stack"><h3>{{ s.winner ? names[s.winner] : exhibitionProgress?.draw && s.phase === 'winner' ? '表演赛平局' : '胜方待确认' }} · {{ series.a }} : {{ series.b }}</h3>
              <p v-if="s.winnerPending" role="status" aria-live="polite" class="operator-hint">{{ winnerRemainingSeconds > 0 ? `已进入 Winner，将在 ${winnerRemainingSeconds} 秒后自动确认 ${names[s.winnerPending.team]} 为胜方。` : '倒计时结束，正在确认胜方…' }}</p>
              <button v-if="s.winnerPending" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('cancel-winner')">取消自动确认</button>
              <button v-for="team in (['a', 'b'] as const)" :key="team" :disabled="disabled || !!s.incident || !canShowWinner(team)" :data-unavailable="connection !== 'synced' || !!s.incident || !canShowWinner(team)" @click="run('winner', { team })">确认 {{ names[team] }} 为胜方</button>
              <button v-if="exhibitionProgress?.draw" :disabled="disabled || !!s.incident" @click="run('winner', { team: null })">确认表演赛平局</button><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="openInitialize">存档并准备下一场</button></div>
            <div v-else-if="panel === 'pause'" class="operator-action-stack">
              <p v-if="s.paused">当前暂停：{{ { normal: '普通暂停', technical: '技术暂停', tactical: '战术暂停' }[s.pauseType] }}</p>
              <button :aria-pressed="s.paused && s.pauseType === 'normal'" :disabled="disabled" @click="run('pause', { kind: 'normal' })">普通暂停</button>
              <button :aria-pressed="s.paused && s.pauseType === 'technical'" :disabled="disabled" @click="run('pause', { kind: 'technical' })">技术暂停</button>
              <button :aria-pressed="s.paused && s.pauseType === 'tactical'" :disabled="disabled" @click="run('pause', { kind: 'tactical' })">战术暂停</button>
              <section class="operator-series-edit" aria-label="暂停倒计时">
                <h3>暂停倒计时</h3>
                <div class="operator-two">
                  <label>分<input v-model.number="pauseForm.minutes" type="number" min="0" max="60" step="1" @keydown.enter.prevent="startPauseTimer"></label>
                  <label>秒<input v-model.number="pauseForm.seconds" type="number" min="0" max="59" step="1" @keydown.enter.prevent="startPauseTimer"></label>
                </div>
                <p role="status" aria-live="polite">{{ pauseTimerHint }}</p>
                <div class="operator-inline">
                  <button :disabled="disabled || !pauseInputValid" :data-unavailable="connection !== 'synced' || !pauseInputValid" @click="startPauseTimer">{{ pauseTimer ? '重新开始倒计时' : '开始倒计时' }}</button>
                  <button v-if="pauseTimer" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="clearPauseTimer">清除倒计时</button>
                </div>
                <p>倒计时只用于现场提示，结束不会自动返回画面。</p>
              </section>
              <section class="operator-series-edit" aria-label="即将开始">
                <h3>即将开始</h3>
                <p role="status" aria-live="polite">{{ resumeAt ? `将在 ${resumeRemainingSeconds} 秒后自动返回暂停前的画面。` : '确认现场就绪后开始 10 秒倒计时，到点自动返回暂停前的画面。' }}</p>
                <div class="operator-inline">
                  <button :disabled="disabled || !!resumeAt || !s.returnScene" :data-unavailable="connection !== 'synced' || !!resumeAt || !s.returnScene" @click="startResumeSoon">即将开始</button>
                </div>
                <p>倒计时期间画面会显示“即将开始...”；仍可手动返回或重新暂停。</p>
              </section>
              <button :disabled="disabled || !s.returnScene" :data-unavailable="connection !== 'synced' || !s.returnScene" @click="run('resume')">返回暂停前的画面</button>
            </div>
          </section>
          <aside class="operator-side">
            <section class="operator-preview"><div class="operator-section-head"><h2>观众正在看</h2><span>{{ sceneLabels[s.scene as Scene] }}</span></div><iframe ref="preview" src="/overlay" title="观众画面预览" @load="sharePreview"></iframe>
      <nav class="operator-scenes" aria-label="一键切换播出画面">
        <span>切换画面 · Alt+1 至 Alt+5</span><button v-for="[scene, label] in scenes" :key="scene" :disabled="disabled" :data-unavailable="connection !== 'synced'" :aria-pressed="s.scene === scene" @click="display(scene)">{{ label }}</button>
      </nav>


            </section>
            <section v-if="round && (incidentOpen || s.incident)" id="incident-panel" class="operator-incident" aria-label="现场处理"><div class="operator-section-head"><h2>现场处理</h2><button v-if="!s.incident" @click="incidentOpen = false">收起</button></div>
              <div v-if="s.incident" class="operator-incident-status" role="status"><strong>暂不加分 · 等待处理</strong><p>{{ round.resultSource === 'review' ? '成绩尚未确认' : incidentLabels[s.incident.kind] }}</p><p>{{ round.resultSource === 'review' ? '自动计胜后分数仍在变化。已撤回本图自动加分；等全部结束，再核对胜方。' : s.incident.source === 'tosu' ? '观战资料有变化，请核对比赛是否仍在继续。' : s.incident.reason }}</p></div>
              <template v-if="round.status !== 'void'">
                <button v-if="round.status === 'prepared'" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="hold('abort', '比赛开始前卡住或取消，保留原选图')">比赛未能开始</button>
                <button v-else :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="hold('player-disconnect', '有人卡住，先等全部结束，暂停本图自动加分')">有人卡住，先等一下</button>
                <button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="hold('spectator', '直播观战画面异常，比赛可能仍在继续，保留本局记录')">直播画面异常，比赛仍在继续</button>
                <button v-if="s.incident && round.status !== 'ranking'" class="operator-primary" :disabled="disabled || !canContinueRound" :data-unavailable="connection !== 'synced' || !canContinueRound" @click="run('resolve-incident', { reason: incidentNote(round.status === 'prepared' ? '保留原选图，继续等待比赛开始' : '直播员确认观战恢复，继续原局') })">{{ round.status === 'prepared' ? '保留原图，等待重新开始' : '观战已恢复，继续原局' }}</button>
                <p v-if="s.incident && round.status !== 'prepared'">恢复观战后仍在比赛，可继续原局；若已结束，请在 Playing 面板核对后人工记胜。</p>
                <button v-if="round.status !== 'prepared'" :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('referee-replay', { reason: incidentNote('裁判已明确要求本图重赛') })">裁判已要求重赛本图</button>
                <label>补充说明（可选）<input v-model="incidentReason" maxlength="160" placeholder="无需填写也能处理"></label><p>等待或重赛会撤回本图已有计胜。重赛只更新播出记录，保留 Pick、BP、EX 与其余系列比分，等待裁判重新开始比赛。若比分曾直接校正，请同时核对系列比分。</p>
              </template><p v-else>本次比赛已作废，请等待重新开始。</p>
            </section>
      <section class="operator-warm-time" aria-label="Warm-up 热身模式">
        <button type="button" :aria-pressed="!!s.warmup" :disabled="disabled" @click="run('warmup', { enabled: !s.warmup })">Warm-up · {{ s.warmup ? '已开启' : '已关闭' }}</button>
      </section>
        <section v-if="!s.warmup && !exhibition" class="operator-ex-quick" aria-label="EX 常用操作">
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
          </aside>
        </div>
        <details id="manual-adjustments" class="operator-records" :open="adjustments" @toggle="adjustments = ($event.target as HTMLDetailsElement).open">
          <summary>比赛纠错 · 谱面 / BP / Ban / 先手 / EX / 比分</summary><div class="operator-inline"><button v-if="resultRound" @click="showManualResult">到 Playing 管理比分</button></div><p>每项只修改对应内容，可用顶部“撤销上一项”恢复。当前系列比分 {{ series.a }} : {{ series.b }}。</p><label>调整补充说明（可选）<input v-model="reason" maxlength="160" placeholder="不填写时自动记录操作原因"></label>
          <div class="operator-manual-grid">
            <section><h3>当前谱面与 Pick 方</h3><label>谱面<ControlSelect v-model="mapForm.entryId" :disabled="!canHandleRound" @change="scheduleSetting('round', true)"><option value="">选择要改成的谱面</option><option v-for="e in s.pool" :key="e.id" :value="e.id">{{ e.label }} · {{ e.title || e.beatmapId }}</option></ControlSelect></label><label v-if="entry(mapForm.entryId)?.mod !== 'TB'">Pick 方<ControlSelect v-model="mapForm.pickedBy" :disabled="!canHandleRound" @change="scheduleSetting('round', true)"><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label><p role="status">{{ settingMessages.round || '修改后立即生效，保留同一局身份与自动流程。' }}</p><p>保留同一轮记录。已计胜的图先撤回，再调整。</p><button :disabled="disabled || !round || round.status === 'recorded'" :data-unavailable="connection !== 'synced' || !round || round.status === 'recorded'" @click="run('void-round', { reason: note('直播员作废当前选图，重新安排 BP') })">作废当前选图，重新 BP</button></section>
            <section><h3>当前 BP 动作</h3><div class="operator-two"><label>队伍<ControlSelect v-model="actionForm.team" @change="scheduleSetting('action', true)"><option value="">请选择</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label><label>动作<ControlSelect v-model="actionForm.kind" @change="scheduleSetting('action', true)"><option value="">请选择</option><option value="ban">Ban</option><option value="pick">Pick</option></ControlSelect></label></div><label v-if="actionForm.kind === 'ban'">Ban 槽<ControlSelect v-model="actionForm.slot" @change="scheduleSetting('action', true)"><option :value="-1">请选择</option><option :value="0">Ban 1</option><option :value="1">Ban 2</option></ControlSelect></label><p role="status">{{ settingMessages.action || '队伍与动作选全后立即生效，不改变后续顺序。' }}</p><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('set-action', { action: null })">取消当前动作</button><button :disabled="disabled || !!s.incident" :data-unavailable="connection !== 'synced' || !!s.incident" @click="run('bp')">手动回到 BP 操作</button><p>只改当前动作，不猜测或重排后续顺序。</p></section>
            <section><h3>真实 Ban 记录</h3>
              <p>直接修改对应队伍的 Ban 1／Ban 2，选后立即同步；其他 Ban、当前局与后续顺序保留。</p>
              <div v-for="team in (['a', 'b'] as const)" :key="team">
                <strong>{{ names[team] }}</strong>
                <div v-for="(_, index) in s.bans[team]" :key="index">
                  <label>Ban {{ index + 1 }}
                    <ControlSelect :value="banSlotValue(team, index)" :aria-label="`${names[team]} Ban ${index + 1}`" :disabled="disabled" @change="correctBan(team, index, $event)">
                      <option value="unknown">未确认</option><option value="empty">空 Ban</option>
                      <option v-for="e in banOptions(team, index)" :key="e.id" :value="`map:${e.id}`">{{ e.label }} · {{ e.title || e.beatmapId }}</option>
                    </ControlSelect>
                  </label>
                  <p role="status">{{ banMessages[`${team}:${index}`] }}</p>
                </div>
              </div>
              <p>已选用／已打的谱面、其他 Ban 槽位的谱面及 TB 不可选。同队 HD／HR／DT 不能重复 Ban，NM／FM 可重复。</p>
            </section>
            <section><h3>Roll 与先手修正</h3><label v-for="[field, label] in rollFields" :key="field">{{ label }}<ControlSelect v-model="rollForm[field]" @change="scheduleSetting(rollSetting(field), true)"><option value="">未确认</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></ControlSelect></label>
              <p role="status">{{ rollStatus }}</p></section>
            <section v-if="!exhibition"><h3>EX 剩余次数修正</h3><p>本图开启／关闭请使用「本图 EX」。</p><div class="operator-two"><label>{{ names.a }} 剩余<input v-model.number="exForm.a" type="number" min="0" max="2" @input="scheduleSetting('ex-a')" @blur="dirtySettings.has('ex-a') && scheduleSetting('ex-a', true)"><span class="operator-hint" role="status">{{ settingMessages['ex-a'] }}</span></label><label>{{ names.b }} 剩余<input v-model.number="exForm.b" type="number" min="0" max="2" @input="scheduleSetting('ex-b')" @blur="dirtySettings.has('ex-b') && scheduleSetting('ex-b', true)"><span class="operator-hint" role="status">{{ settingMessages['ex-b'] }}</span></label></div><p>修改后自动同步，无需保存；不推定实际上场名单。</p></section>

          </div>
          <section><h3>逐局赛果修正</h3><div v-for="r in s.rounds.filter(r => r.status === 'recorded')" :key="r.id" class="operator-round-record"><span>{{ entry(r.entryId)?.label }} · {{ r.winner ? names[r.winner] : '未知' }} 胜 · {{ r.resultSource === 'tosu' ? '自动' : '人工' }}</span><div class="operator-inline"><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('correct-result', { roundId: r.id, winner: r.winner === 'a' ? 'b' : 'a', reason: note('直播员核对后修正胜方') })">改为 {{ names[r.winner === 'a' ? 'b' : 'a'] }} 胜</button><button :disabled="disabled" :data-unavailable="connection !== 'synced'" @click="run('retract-result', { roundId: r.id, reason: note('直播员撤回计胜，等待核对') })">撤回计胜</button></div></div></section>
        </details>
        <details class="operator-records"><summary>最近操作记录</summary><ol class="operator-history"><li v-for="item in [...s.history].reverse().slice(0, 40)" :key="item.id"><time>{{ operationTime(item.at) }}</time><span>{{ item.message }}</span><b>{{ item.source === 'tosu' ? '自动' : '人工' }}</b></li><li v-if="!s.history.length">尚无操作记录</li></ol></details>
      </template>
    </template>
    <dialog ref="startupDialog" class="operator-initialize-dialog desk-startup" aria-labelledby="startup-title" @cancel.prevent>
      <h2 id="startup-title">继续上次的比赛？</h2>
      <p>上次保存的对阵</p>
      <strong>{{ s?.match.teams.a.name }}　{{ series.a }} : {{ series.b }}　{{ s?.match.teams.b.name }}</strong>
      <button type="button" class="operator-primary" autofocus :disabled="disabled" @click="chooseStartup(false)">
        继续上场比赛<small>沿用队伍、图池、比分和禁选进度</small>
      </button>
      <button type="button" :disabled="disabled" @click="chooseStartup(true)">
        存档并开始新比赛<small>保存上一场，从零比分重新设置队伍和图池</small>
      </button>
      <p v-if="connection !== 'synced'" role="status">正在连接比赛服务…</p>
      <p v-if="error" role="alert">{{ error }}</p>
    </dialog>
    <dialog ref="initializeDialog" class="operator-initialize-dialog" aria-labelledby="initialize-title" aria-describedby="initialize-description" @cancel="initializeError = ''">
      <form @submit.prevent="initializeMatch">
        <h2 id="initialize-title">初始化本场比赛？</h2>
        <p id="initialize-description">队伍、名单、图池、Roll、Ban/Pick、比分和比赛进度都会清空。未跟踪的赛果不会补记。</p>
        <label v-if="canKeepRoomBinding" class="operator-check"><input v-model="keepRoomBinding" type="checkbox">保留当前房间连接与自动跟随设置（{{ s?.auto.left }} / {{ s?.auto.right }}）</label>
        <p>{{ keepRoomBinding ? '中途重新开始时，保留自动跟随设置。' : '同时重置自动跟随设置；房间队名仍会从 tosu 自动读取。' }}</p>
        <p>当前比赛会先存档。误操作可用“撤销上一项”恢复。</p>
        <div class="operator-initialize-actions"><button type="button" autofocus @click="initializeDialog?.close()">取消</button><button type="submit" class="operator-reset" :disabled="disabled" :data-unavailable="connection !== 'synced'">清空并重新设置</button></div>
        <p class="operator-initialize-error" role="alert">{{ initializeError }}</p>
      </form>
    </dialog>
    <dialog ref="clearRecordsDialog" class="operator-initialize-dialog" aria-labelledby="clear-records-title" aria-describedby="clear-records-description" @cancel="clearRecordsError = ''">
      <form @submit.prevent="clearAllRecords">
        <h2 id="clear-records-title">撤销全部比赛记录？</h2>
        <p id="clear-records-description">Roll、Ban/Pick、逐局赛果、系列比分、EX、暂停与画面覆盖都会清空，回到开场等待。</p>
        <p><strong>保留</strong>本场队伍、名单、图池、标题、阶段、人数、比例和自动跟随设置。</p>
        <p>此前操作记录会清空，只保留本次“全部撤销”；误操作可用“撤销上一项”恢复一次。</p>
        <div class="operator-initialize-actions"><button type="button" autofocus @click="clearRecordsDialog?.close()">取消</button><button type="submit" class="operator-reset" :disabled="disabled" :data-unavailable="connection !== 'synced'">全部撤销</button></div>
        <p class="operator-initialize-error" role="alert">{{ clearRecordsError }}</p>
      </form>
    </dialog>
  </main>
</template>
