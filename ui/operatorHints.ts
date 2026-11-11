import type { RoomReview, Session } from './session';
import type { Scene } from './model';

// Describe the observed state, independently of the page the operator selected.
// These hints guide existing actions; they do not advance or infer a match.
export function operatorNextStep(s: Session | undefined, panel: Scene, connection: string, hasScores: boolean, target: number, selectedMap?: string, ipc?: number | null, review?: RoomReview | null) {
  if (connection !== 'synced' || !s) return '控制台正在重连，请等连接恢复后核对最近操作。';
  if (s.paused) return '播出已暂停，准备好后点击「返回原画面」。';
  if (s.incident) return '本图暂不自动加分，请在「处理异常」按现场情况继续或核对赛果。';
  const round = s.rounds.find(r => r.id === s.currentRoundId);
  const tb = s.bp?.tiebreaker;
  const matchPanel = panel === 'playing' || panel === 'mappool';
  if (review) {
    const context = review.kind === 'tb' ? `房间已载入决胜图 ${review.roomLabel}，尚未确认 TB。`
      : `已准备 ${review.preparedLabel}，房间当前为 ${review.roomLabel}。`;
    if (!review.entryId) {
      const progress = review.stage === 'finished' ? '房间已结算，此图未计胜。' : review.stage === 'playing' ? '房间已开打，此图暂不自动计胜。' : '';
      return context + '房间谱面' + (review.unavailableReason || '不可用') + '。' + progress +
        '请与裁判核对。若继续原 Pick，请切回已准备的图；若需重选，请打开「比赛纠错」，点击「作废当前选图，重新 BP」。';
    }
    if (review.stage === 'ranking') return context + '房间仍在结算，尚未观察到此图开打。请核对现场，返回准备后再操作。';
    if (review.stage === 'playing') return context + '房间已开打，此图暂不自动计胜。请核对现场，结算时人工确认赛果。';
    if (review.stage === 'finished') return context + '房间已出现结算。请核对确已打完的谱面，再记录胜方。';
    return context + (review.kind === 'tb' ? '开打前请确认准备决胜图。' : '请确认改用房间谱面，或让裁判切回已准备的图。');
  }
  if (round?.status === 'ranking' && round.resultSource === 'manual-finish') return '本图已确认结束，请核对后记录胜方。';
  if (panel === 'pause') return '当前展示暂停画面，可按现场情况切回所需画面。';
  if (panel === 'waiting') return '按现场情况勾选到场与就绪，双方到齐后可开始 Roll。';
  if (panel === 'roll' && s.match.stage === 'exhibition') {
    if (s.bp?.mode === 'manual' || s.action?.kind === 'ban') return '本场已调整禁选顺序，可到图池查看当前动作。';
    return s.roll.pickFirst
      ? `表演赛默认轮流选图，先选队伍为${s.match.teams[s.roll.pickFirst].name}。`
      : '表演赛默认轮流选图，请按 Roll 结果选择先 Pick 的队伍。';
  }
  if (panel === 'roll') return s.roll.pickFirst && s.roll.banFirst ? '先手已记录，可切到图池进行 Ban／Pick。' : '记录 Roll 点数与先 Ban、先 Pick 队伍，已有比赛可直接切到现场画面。';
  if (panel === 'victory') return '核对最终比分与胜方，确认后展示 Winner 或初始化下一场。';
  if (round?.status === 'playing') return panel === 'mappool' ? '本图仍在比赛，可切到 Playing 查看队分，结束后再继续 Ban／Pick。' : '本图正在比赛，等待结束；需要等待或重赛时使用「处理异常」。';
  if (round?.status === 'ranking' && round.resultSource !== 'series-correction') {
    if (s.match.exhibition && !s.match.exhibition.autoResults) return '本图已结束，请在 Playing 核对后记录赛果或校正系列比分。';
    return s.auto.results ? '本图已结束，等待成绩确认；需要修正时在 Playing 直接校正系列比分。'
      : '本图已结束，自动计胜已关闭，请在 Playing 核对后记胜或校正系列比分。';
  }
  if (matchPanel && s.exhibition?.complete) return s.exhibition.draw || s.exhibition.winner
    ? '表演赛已达到结束条件，请核对后展示最终结果。' : '已完成指定图数，赛制未允许全场平局。请按裁判结果核对比分。';
  if (matchPanel && !s.exhibition && target > 0 && Object.values(s.series).some(score => score >= target)) return '系列比分已到先胜目标，请核对后在 Playing 展示 Winner。';
  if (tb?.active && round?.status === 'prepared') return tb.eligible ? 'TB 决胜图已准备，等待比赛开始，双方使用常规人数。' : '系列比分已改变，请先核对决胜比分再开始 TB。';
  if (tb?.eligible && !s.exhibition) {
    if (!tb.canPrepare) return tb.reason;
    const count = s.pool.filter(e => e.mod === 'TB').length;
    if (count !== 1) return '本场有多张 TB，请在开播前设置确定唯一决胜图。';
    return panel === 'mappool' ? '已到决胜比分，按裁判确认点击 TieBreaker 准备决胜图。' : '已到决胜比分，请切到图池点击 TieBreaker。';
  }
  if (ipc === 4 && panel === 'playing' && s.auto.scenes &&
      (round?.resultSource === 'series-correction' || round?.status === 'recorded')) return '结算展示中，房间回到准备后将自动回到图池。';
  if (round?.resultSource === 'series-correction' || round?.status === 'recorded') return panel === 'mappool' ? '本图比分已处理，可继续现场 Ban／Pick。' : '本图比分已处理，可切回图池继续，无需重复记胜。';
  if (round?.status === 'prepared') return '本图已准备，等待比赛开始；比赛开始前可更换选图。';
  if (panel === 'mappool') {
    if (!s.pool.length) return '本场尚无图池，请在「开播前设置」选择或录入本场图池。';
    if (s.pool.find(e => e.id === selectedMap)?.mod === 'TB') return '已选中 TB，请核对决胜比分后点击 TieBreaker。';
    if (s.bp?.stopped) return s.bp.waiting || '常规 BP 已停止，请核对比分。';
    if (s.action) return `自动待处理：${s.match.teams[s.action.team].name} ${s.action.kind === 'ban' ? `Ban${s.action.slot == null ? '' : ` ${s.action.slot + 1}`}` : 'Pick'}；房间换图后自动记录，也可直接选择谱面。`;
    if (s.poolChoice) return `已选择 ${s.match.teams[s.poolChoice.team].name} ${s.poolChoice.kind === 'ban' ? 'Ban' : 'Pick'}，请选择本图或等待房间换图。`;
    return '选择现场 Ban／Pick 队伍与谱面，中途加入无需补录之前的操作。';
  }
  if (hasScores) return '房间队分正在显示，本局尚无记录；可继续播出，结束后核对系列比分。';
  return '等待比赛开始；需要手动准备时切到图池，选择队伍 Pick 与本局谱面。';
}
