import { computed, inject, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch, type InjectionKey } from 'vue';
import { banLabel, changeBan, changeField, derive, mapIcons, mapLabels, mapMods, normalizeScene, parseLocation, scenes, serializeState, teamNames, urlKeys, type Field, type Team, type Scene } from './model';
import { useSession } from './session';
import { useMotionReady } from './motion';
import { poolDisplay } from './poolDisplay';
import { liveBeatmap, livePlayingMap, liveRoom, liveRoomChat, liveTeamScores, resultTeamScores } from './liveScores';
import { retainRankingScores, type RankingScoreHold } from './rankingScoreHold';

export function createOverlay(shared = false) {
  const state = reactive(parseLocation(shared ? '' : location.search, shared ? '' : location.hash));
  const sessionClient = shared ? useSession() : null;
  const session = computed(() => sessionClient?.snapshot.value?.session || null);
  const motionScope = computed(() => shared ? `${session.value?.id}:${sessionClient?.presentationEpoch.value}:${sessionClient?.connection.value}` : 'demo');
  const motionReady = useMotionReady(motionScope);
  if (shared) watch(session, s => {
    state.clean = true; state.seriesA = s?.series.a ?? null;
    state.seriesB = s?.series.b ?? null;
    if (!s) return;
    state.scene = normalizeScene(s.scene); state.mode = s.match.mode; state.source = s.match.source; state.stage = s.match.stage;
    state.pickFirst = s.roll.pickFirst || 'unknown'; state.banFirst = s.roll.banFirst || 'unknown';
    state.pauseType = s.pauseType; state.exTeam = s.ex.team || 'none'; state.exA = s.ex.remaining.a; state.exB = s.ex.remaining.b;
    const entry = s.pool.find(e => e.id === s.rounds.find(r => r.id === s.currentRoundId)?.entryId);
    state.mapType = entry?.mod === 'TB' ? 'tb' : 'normal';
    state.mapMod = ['NM', 'HD', 'HR', 'DT', 'FM'].includes(entry?.mod || '') ? entry!.mod as typeof state.mapMod : 'NM';
  }, { immediate: true });
  const rankingScores = shallowRef<RankingScoreHold | null>(null);
  if (shared) watch([() => sessionClient?.snapshot.value, () => sessionClient?.connection.value, () => state.scene],
    ([envelope, connection, scene]) => {
      rankingScores.value = retainRankingScores(envelope, connection, scene, rankingScores.value);
    }, { immediate: true, flush: 'sync' });
  const view = computed(() => {
    const base = derive(state);
    const s = session.value;
    const envelope = sessionClient?.snapshot.value;
    const names = s ? { a: s.match.teams.a.name, b: s.match.teams.b.name } : shared ? { a: '左队待设置', b: '右队待设置' } : teamNames;
    const round = s?.rounds.find(r => r.id === s.currentRoundId);
    const recordedMap = s?.pool.find(e => e.id === round?.entryId) || null;
    const roster = (team: Team) => shared ? Array.from({ length: base.count }, (_, i) => ({
      team, id: `${team}-${i + 1}`, slot: i + 1, role: '', syntheticEx: false,
      name: s?.ex.team ? null : s?.match.teams[team].roster[i]?.name || null
    })) : base.roster(team);
    const arrived = (team: Team) => shared ? s?.arrived[team] || false : base.arrived(team);
    const bound = liveRoom(envelope, sessionClient?.connection.value);
    const scores = rankingScores.value?.scores || liveTeamScores(envelope, sessionClient?.connection.value);
    const liveMap = state.scene === 'playing' || bound ? liveBeatmap(envelope, sessionClient?.connection.value) : null;
    const currentMap = state.scene === 'playing' ? livePlayingMap(envelope, sessionClient?.connection.value, recordedMap) || recordedMap : recordedMap;
    const mapParameters = currentMap && liveMap?.id === currentMap.beatmapId ? liveMap : null;
    const formatted = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-US');
    const scoreA = shared ? formatted(scores?.left) : base.scoreA;
    const scoreB = shared ? formatted(scores?.right) : base.scoreB;
    const resultScores = rankingScores.value?.scores || resultTeamScores(envelope, sessionClient?.connection.value);
    const resultA = shared ? formatted(resultScores?.left) : base.resultA;
    const resultB = shared ? formatted(resultScores?.right) : base.resultB;
    const pool = shared ? (s?.pool || []).map(entry => {
      const { status, team } = poolDisplay(s!, entry.id);
      return { ...entry, status, actionTeam: team,
        statusLabel: team && status !== 'open' ? `${names[team]} ${status === 'banned' ? 'Ban' : status === 'used' ? '已打' : 'Pick'}` : '', icon: status === 'banned' ? '×' : status !== 'open' ? '✓' : '' };
    }) : mapMods.map((mod, index) => {
      const status = index === 0 ? state.map : 'open';
      return { id: String(index), beatmapId: 0, mod, label: `${mod}${mapMods.slice(0, index + 1).filter(m => m === mod).length}`, title: '谱面标题占位', artist: '艺术家', difficulty: '难度', status, actionTeam: null,
        statusLabel: status === 'open' ? '' : mapLabels[status], icon: status === 'open' ? '' : mapIcons[status] };
    });
    return { ...base, shared, names, roster, players: (['a', 'b'] as const).flatMap(roster), arrived,
      ready: (team: Team) => shared ? s?.ready[team] || false : false,
      orderLabel: (value: string) => value === 'a' || value === 'b' ? names[value] : '未确认',
      banText: (team: Team, index: 0 | 1) => {
        if (!shared) return banLabel(state.banSlots[team][index]);
        if (s?.emptyBans?.[team][index]) return '空 Ban';
        const ids = [...new Set([...(s?.bans[team] || []), ...pool.map(e => e.id)])]
          .filter(id => pool.some(e => e.id === id && e.status === 'banned' && e.actionTeam === team));
        return pool.find(e => e.id === ids[index])?.label || '未确认';
      },
      scoreA, scoreB, resultA, resultB, pool, currentMap, mapParameters,
      showPlayingScores: !shared || !!scores,
      parameterMode: envelope?.live.sources?.tosu === 'simulated' ? 'official-test' as const : 'tosu' as const,
      winner: s?.winner ? names[s.winner] : null,
      roll: s?.roll || null, title: s?.match.title || 'OCLR S11',
      season: s?.match.edition?.match(/^s\d+$/) ? s.match.edition.toUpperCase() : 'S11',
      chat: shared ? liveRoomChat(envelope, sessionClient?.connection.value).slice(-4) : [],
      sourceStatus: shared ? envelope?.live.tosu.status || '未连接' : 'demo',
      arrivalCount: shared ? (['a', 'b'] as const).filter(arrived).length * base.count : base.arrivalCount,
      readiness: shared ? (s?.ready.a && s?.ready.b ? '双方已就绪' : '等待到场 / 就绪确认') : base.readiness,
      readinessCopy: shared ? '状态由直播员人工核对。' : base.readinessCopy,
      commentary: shared ? '本机播出记录 · 实际名单由直播员核对' : base.commentary,
      exLabel: shared && s?.ex.team ? `EX · ${names[s.ex.team]}开启` : base.exLabel,
      connection: sessionClient?.connection.value || 'demo'
    };
  });
  const feedback = ref('Ban 槽默认未确认。');
  const update = (field: Field, value: string) => Object.assign(state, changeField(state, field, value));
  const select = (field: Field, event: Event) => update(field, (event.target as HTMLSelectElement).value);
  const ban = (team: Team, index: 0 | 1, event: Event) => {
    const select = event.target as HTMLSelectElement;
    const result = changeBan(state, team, index, select.value);
    Object.assign(state, result.state);
    select.value = state.banSlots[team][index];
    feedback.value = result.feedback;
  };
  const cycleMap = () => {
    const order = ['banned', 'picked', 'open'] as const;
    update('map', order[(order.indexOf(state.map) + 1) % order.length]!);
  };
  const toggleClean = () => {
    update('clean', state.clean ? '0' : '1');
    if (state.clean && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return;
    if (/^[1-6]$/.test(event.key)) {
      event.preventDefault(); update('scene', scenes[Number(event.key) - 1]!);
    } else if (event.key.toLowerCase() === 'c' || (event.key === 'Escape' && state.clean)) {
      event.preventDefault(); toggleClean();
    }
  };
  const onLocation = () => Object.assign(state, parseLocation(location.search, location.hash));
  const stopWatch = watch(state, () => {
    if (shared) { document.body.classList.add('is-clean'); document.title = 'OCLR · 共享直播输出'; return; }
    const url = new URL(location.href);
    for (const key of [...Object.values(urlKeys), 'banA1', 'banA2', 'banB1', 'banB2']) url.searchParams.delete(key);
    url.hash = serializeState(state);
    try { history.replaceState(null, '', url); } catch { /* OBS can restrict history; rendering still works. */ }
    document.body.classList.toggle('is-clean', state.clean);
    Object.assign(document.body.dataset, {
      scene: state.scene, clean: String(state.clean), mode: state.mode,
      activeMode: `${view.value.count}v${view.value.count}`, lead: state.lead
    });
    document.title = state.clean ? '干净输出 · Esc 退出 · OCLR S11 Neon Broadcast' : 'OCLR S11 直播 UI · Neon Broadcast 视觉评审';
  }, { immediate: true, flush: 'sync' });
  onMounted(() => {
    if (shared) return;
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('hashchange', onLocation);
    window.addEventListener('popstate', onLocation);
  });
  onUnmounted(() => {
    stopWatch();
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('hashchange', onLocation);
    window.removeEventListener('popstate', onLocation);
    document.body.classList.remove('is-clean');
    for (const key of ['scene', 'clean', 'mode', 'activeMode', 'lead']) delete document.body.dataset[key];
  });
  return { state, view, motionScope, motionReady, feedback, update, select, ban, toggleClean, cycleMap, mapLabels };
}
export type OverlayController = ReturnType<typeof createOverlay>;
export const overlayKey: InjectionKey<OverlayController> = Symbol('overlay');
export function useOverlay() {
  const controller = inject(overlayKey);
  if (!controller) throw new Error('OVERLAY_PROVIDER_REQUIRED');
  return controller;
}

export function useCanvasFit() {
  const stage = ref<HTMLElement | null>(null);
  const scale = ref(1);
  let frame = 0;
  let observer: ResizeObserver | undefined;
  let disposed = false;
  const fit = () => {
    const element = stage.value;
    if (!element) return;
    const style = getComputedStyle(element);
    const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    scale.value = Math.max(0.001, Math.min(width / 1920, height / 1080));
  };
  const schedule = () => {
    if (disposed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };
  onMounted(async () => {
    await nextTick();
    if (disposed) return;
    fit();
    observer = new ResizeObserver(schedule);
    if (stage.value) observer.observe(stage.value);
    window.addEventListener('resize', schedule);
    void document.fonts.ready.then(schedule);
  });
  onUnmounted(() => { disposed = true; observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); });
  return { stage, scale };
}
