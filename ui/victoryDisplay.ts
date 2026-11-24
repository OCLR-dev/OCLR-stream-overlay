import type { RosterMember, Team } from './model';
import type { PoolEntry, Round } from './session';
import { formatTeamScore } from './scoreFormat.ts';

export type DemoWinner = 'pending' | 'a' | 'b' | 'draw';

export type HeroRosterDensity = 'hero-wide' | 'hero-row' | 'grid-4' | 'grid-6' | 'grid-ultra';
export type DualRosterDensity = 'dual-2x2' | 'dual-3x2' | 'dual-4x2' | 'dual-dense' | 'dual-ultra';

export interface VictoryRecapItem {
  id: string;
  order: number;
  beatmapId: number;
  setId?: number;
  mod: string;
  label: string;
  title: string;
  pickedBy: Team | null;
  winner: Team | null;
  exTeam: Team | null;
  isBreak: boolean;
  marginText: string | null;
}

const NON_GRAND_FINAL_RE =
  /(半决赛|胜者组|败者组|胜决|败决|季军|三四名|小组|淘汰|八强|十六强|32强|64强|四分之一|semi[-\s]*finals?|quarter[-\s]*finals?|winners?'?\s*finals?|losers?'?\s*finals?|upper\s*finals?|lower\s*finals?|third\s*place|3rd\s*place|\bwf\b|\blf\b|\bsf\b|\bqf\b|\bro\d+\b)/i;

const GRAND_FINAL_RE = /(grand\s*finals?|\bgf\b|总决赛|冠亚军)/i;
export function isChampionshipRound(roundName: string | null | undefined): boolean {
  return !!roundName && !NON_GRAND_FINAL_RE.test(roundName) && GRAND_FINAL_RE.test(roundName);
}

export function formatScoreMargin(finalScore: Round['finalScore']): string | null {
  const a = finalScore?.a;
  const b = finalScore?.b;
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const diff = Math.abs(a - b);
  if (diff === 0) return '平分';
  if (diff >= 10000) return `+${Math.round(diff / 1000)}k`;
  return `+${formatTeamScore(diff)}`;
}

export function buildRecapRounds(rounds: readonly Round[], pool: readonly PoolEntry[]): VictoryRecapItem[] {
  const poolById = new Map(pool.map(entry => [entry.id, entry]));
  const recorded = rounds.filter(round => round.status === 'recorded');
  return recorded.map((round, index) => {
    const entry = poolById.get(round.entryId);
    const mod = entry?.mod || 'NM';
    const isTb = mod === 'TB';
    const pickedBy = isTb ? null : round.pickedBy ?? null;
    const winner = round.winner ?? null;
    return {
      id: round.id,
      order: index + 1,
      beatmapId: entry?.beatmapId || 0,
      ...(entry?.setId ? { setId: entry.setId } : {}),
      mod,
      label: entry?.label || mod,
      title: entry?.title || '',
      pickedBy,
      winner,
      exTeam: round.exTeam ?? null,
      isBreak: Boolean(pickedBy && winner && pickedBy !== winner),
      marginText: formatScoreMargin(round.finalScore),
    };
  });
}

export function buildDemoRecapRounds(winnerDemo: DemoWinner, stage: string): VictoryRecapItem[] {
  if (winnerDemo === 'pending') return [];
  if (winnerDemo === 'draw') {
    const drawScript: Array<{ label: string; mod: string; pick: Team; win: Team | null; margin: string }> = [
      { label: 'NM1', mod: 'NM', pick: 'a', win: 'a', margin: '+112k' },
      { label: 'HD1', mod: 'HD', pick: 'b', win: 'b', margin: '+84k' },
      { label: 'HR2', mod: 'HR', pick: 'a', win: 'b', margin: '+46k' },
      { label: 'DT1', mod: 'DT', pick: 'b', win: 'a', margin: '+165k' },
    ];
    return drawScript.map((item, idx) => ({
      id: `demo-draw-${idx + 1}`,
      order: idx + 1,
      beatmapId: 0,
      mod: item.mod,
      label: item.label,
      title: '演示谱面记录',
      pickedBy: item.pick,
      winner: item.win,
      exTeam: null,
      isBreak: Boolean(item.win && item.pick !== item.win),
      marginText: item.margin,
    }));
  }

  const w: Team = winnerDemo;
  const l: Team = w === 'a' ? 'b' : 'a';
  const isFinal = stage === 'final';
  const script: Array<{ label: string; mod: string; pick: Team | null; win: Team; ex?: Team; margin: string }> = isFinal
    ? [
        { label: 'NM1', mod: 'NM', pick: w, win: w, margin: '+142k' },
        { label: 'HD1', mod: 'HD', pick: l, win: l, margin: '+96k' },
        { label: 'HR1', mod: 'HR', pick: w, win: w, margin: '+188k' },
        { label: 'DT2', mod: 'DT', pick: l, win: w, margin: '+64k' },
        { label: 'FM1', mod: 'FM', pick: w, win: l, ex: l, margin: '+53k' },
        { label: 'NM3', mod: 'NM', pick: l, win: l, margin: '+119k' },
        { label: 'HD2', mod: 'HD', pick: w, win: w, ex: w, margin: '+215k' },
        { label: 'HR2', mod: 'HR', pick: l, win: l, margin: '+78k' },
        { label: 'DT1', mod: 'DT', pick: w, win: w, margin: '+134k' },
        { label: 'FM2', mod: 'FM', pick: l, win: l, margin: '+41k' },
        { label: 'NM5', mod: 'NM', pick: w, win: l, margin: '+29k' },
        { label: 'FM3', mod: 'FM', pick: l, win: w, margin: '+92k' },
        { label: 'TB', mod: 'TB', pick: null, win: w, margin: '+176k' },
      ]
    : [
        { label: 'NM1', mod: 'NM', pick: w, win: w, margin: '+154k' },
        { label: 'HD1', mod: 'HD', pick: l, win: l, margin: '+88k' },
        { label: 'HR2', mod: 'HR', pick: w, win: w, margin: '+206k' },
        { label: 'DT1', mod: 'DT', pick: l, win: w, margin: '+67k' },
        { label: 'FM1', mod: 'FM', pick: w, win: l, ex: l, margin: '+51k' },
        { label: 'NM4', mod: 'NM', pick: l, win: l, margin: '+112k' },
        { label: 'HD2', mod: 'HD', pick: w, win: w, ex: w, margin: '+193k' },
        { label: 'DT2', mod: 'DT', pick: l, win: w, margin: '+74k' },
        { label: 'FM2', mod: 'FM', pick: w, win: w, margin: '+168k' },
      ];

  return script.map((item, idx) => ({
    id: `demo-recap-${idx + 1}`,
    order: idx + 1,
    beatmapId: 0,
    mod: item.mod,
    label: item.label,
    title: '演示谱面记录',
    pickedBy: item.pick,
    winner: item.win,
    exTeam: item.ex ?? null,
    isBreak: Boolean(item.pick && item.pick !== item.win),
    marginText: item.margin,
  }));
}

export function heroRosterDensity(count: number): HeroRosterDensity {
  if (count <= 4) return 'hero-wide';
  if (count <= 6) return 'hero-row';
  if (count <= 8) return 'grid-4';
  if (count <= 12) return 'grid-6';
  return 'grid-ultra';
}

export function dualRosterDensity(count: number): DualRosterDensity {
  if (count <= 4) return 'dual-2x2';
  if (count <= 6) return 'dual-3x2';
  if (count <= 8) return 'dual-4x2';
  if (count <= 12) return 'dual-dense';
  return 'dual-ultra';
}

export function recapStripDensity(count: number): 'spacious' | 'compact' | 'ultra' | 'dense' {
  if (count <= 8) return 'spacious';
  if (count <= 13) return 'compact';
  if (count <= 20) return 'ultra';
  return 'dense';
}

export function realRosterMembers(members: readonly RosterMember[], hasRoster: boolean): RosterMember[] {
  if (!hasRoster) return [];
  return members.filter(member => !member.placeholder);
}

export function winnerHeadlineTier(text: string): 'xl' | 'lg' | 'md' | 'sm' {
  const units = [...text].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2eff ? 1.75 : 1), 0);
  if (units <= 14) return 'xl';
  if (units <= 22) return 'lg';
  if (units <= 34) return 'md';
  return 'sm';
}
