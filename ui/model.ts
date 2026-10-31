// Local demonstration state. No API records, player identity or official result
// is inferred here; live data remains a separate subscription boundary.
export const scenes = ['waiting', 'mappool', 'playing', 'victory', 'pause', 'roll'] as const;
export type Scene = typeof scenes[number];
export type Team = 'a' | 'b';
export const regularMods = ['NM', 'HD', 'HR', 'DT', 'FM'] as const;
export type Ban = 'unknown' | 'empty' | typeof regularMods[number];
const singleBanMods = ['HD', 'HR', 'DT'];
export const sceneLabels: Record<Scene, string> = {
  waiting: '等待选手', mappool: 'Mappool Ban/Pick', playing: 'Playing',
  victory: '全场胜利', pause: '暂停 / 技术处理', roll: 'Roll / 先手'
};
export const teams = ['a', 'b'] as const;
export const teamNames = { a: '示例A队', b: '示例B队' };
export const stages = {
  group: { label: '小组赛', format: 'BO11', target: 6 },
  elimination: { label: '淘汰赛', format: 'BO11', target: 6 },
  final: { label: '决赛', format: 'BO13', target: 7 }
} as const;
export const leadDemos = {
  'left-small': ['1,050,000', '1,000,000'], 'left-large': ['1,400,000', '1,000,000'],
  equal: ['1,000,000', '1,000,000'], 'right-small': ['1,000,000', '1,050,000'],
  'right-large': ['1,000,000', '1,400,000']
} as const;
export const mapLabels = { open: '未选', banned: '禁用 · 示例A队', picked: '选用 · 示例B队' };
export const mapIcons = { open: '○', banned: '×', picked: '✓' };
export const mapMods = ['NM', 'HD', 'HR', 'FM', 'NM', 'HD', 'HR', 'FM', 'NM', 'HD', 'HR', 'FM', 'NM', 'HD', 'HR', 'FM', 'NM', 'DT', 'DT', 'TB'];
export interface OverlayState {
  scene: Scene;
  mode: '3v3' | '4v4';
  source: '4x3' | '16x9';
  lead: keyof typeof leadDemos;
  clean: boolean;
  arrival: 'none' | 'a' | 'both';
  map: keyof typeof mapLabels;
  stage: keyof typeof stages;
  mapType: 'normal' | 'tb';
  mapMod: typeof regularMods[number] | 'CA';
  exTeam: 'none' | Team;
  exA: number;
  exB: number;
  seriesA: number | null;
  seriesB: number | null;
  pickFirst: 'unknown' | Team;
  banFirst: 'unknown' | Team;
  banSlots: Record<Team, [Ban, Ban]>;
  pauseType: 'tactical' | 'technical';
  tacticalA: 'available' | 'used';
  tacticalB: 'available' | 'used';
  rematchA: 'unknown' | 'available' | 'used';
  rematchB: 'unknown' | 'available' | 'used';
}
export type Field = Exclude<keyof OverlayState, 'banSlots'>;
export const urlKeys = {
  scene: 'scene', mode: 'mode', source: 'source', lead: 'lead', clean: 'clean',
  arrival: 'arrival', map: 'map', stage: 'stage', mapType: 'maptype', mapMod: 'mod',
  exTeam: 'exTeam', exA: 'exA', exB: 'exB', seriesA: 'starA', seriesB: 'starB',
  pickFirst: 'pickFirst', banFirst: 'banFirst', pauseType: 'pauseType',
  tacticalA: 'tacticalA', tacticalB: 'tacticalB', rematchA: 'rematchA', rematchB: 'rematchB'
} satisfies Record<Field, string>;

function known<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback;
}
function series(value: string | null, target: number): number | null {
  if (value === null || value === '' || value === 'unknown') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= target ? n : null;
}
function exRemaining(value: string | null): number {
  return value !== null && value !== '' && ['0', '1', '2'].includes(value) ? Number(value) : 2;
}
export function banLabel(value: Ban): string {
  return value === 'unknown' ? '未确认' : value === 'empty' ? '空Ban' : value;
}
export function normalizeScene(value: string | null | undefined): Scene {
  const scene = value === 'map-result' ? 'playing' : value;
  return scenes.includes(scene as Scene) ? scene as Scene : 'waiting';
}
export function parseLocation(search = '', hash = ''): OverlayState {
  const query = new URLSearchParams(search);
  const raw = hash.replace(/^#/, '');
  const fragment = new URLSearchParams(raw);
  const get = (key: string) => fragment.has(key) ? fragment.get(key) : query.get(key);
  const stage = known(get('stage'), ['group', 'elimination', 'final'], 'group');
  const mapType = known(get('maptype'), ['normal', 'tb'], 'normal');
  const readBans = (team: 'A' | 'B'): [Ban, Ban] => {
    const options = ['unknown', 'empty', ...regularMods] as const;
    const pair: [Ban, Ban] = [known(get(`ban${team}1`), options, 'unknown'), known(get(`ban${team}2`), options, 'unknown')];
    if (pair[0] === pair[1] && singleBanMods.includes(pair[0])) pair[1] = 'unknown';
    return pair;
  };
  let lead = get('lead');
  if (lead === 'left' || lead === 'right') lead = `${lead}-small`;
  return {
    scene: normalizeScene(fragment.get('scene') || (scenes.includes(raw as Scene) || raw === 'map-result' ? raw : query.get('scene'))),
    mode: known(get('mode'), ['3v3', '4v4'], '4v4'), source: known(get('source'), ['4x3', '16x9'], '4x3'),
    lead: known(lead, Object.keys(leadDemos) as OverlayState['lead'][], 'equal'),
    clean: ['1', 'true'].includes(get('clean') || ''),
    arrival: known(get('arrival'), ['none', 'a', 'both'], 'none'),
    map: known(get('map'), ['open', 'banned', 'picked'], 'banned'), stage, mapType,
    mapMod: known(get('mod'), regularMods, 'NM'),
    exTeam: mapType === 'tb' ? 'none' : known(get('exTeam'), ['none', 'a', 'b'], 'none'),
    exA: exRemaining(get('exA')), exB: exRemaining(get('exB')),
    seriesA: series(get('starA'), stages[stage].target), seriesB: series(get('starB'), stages[stage].target),
    pickFirst: known(get('pickFirst'), ['unknown', 'a', 'b'], 'unknown'),
    banFirst: known(get('banFirst'), ['unknown', 'a', 'b'], 'unknown'),
    banSlots: { a: readBans('A'), b: readBans('B') },
    pauseType: known(get('pauseType'), ['tactical', 'technical'], 'tactical'),
    tacticalA: known(get('tacticalA'), ['available', 'used'], 'available'),
    tacticalB: known(get('tacticalB'), ['available', 'used'], 'available'),
    rematchA: known(get('rematchA'), ['unknown', 'available', 'used'], 'unknown'),
    rematchB: known(get('rematchB'), ['unknown', 'available', 'used'], 'unknown')
  };
}
export function serializeState(state: OverlayState): string {
  const params = new URLSearchParams();
  for (const field of Object.keys(urlKeys) as Field[]) {
    const value = state[field];
    params.set(urlKeys[field], value === null ? 'unknown' : typeof value === 'boolean' ? value ? '1' : '0' : String(value));
  }
  for (const team of teams) state.banSlots[team].forEach((value, index) => params.set(`ban${team.toUpperCase()}${index + 1}`, value));
  return params.toString();
}
export function changeField(state: OverlayState, field: Field, value: string): OverlayState {
  if (field === 'exTeam' && state.mapType === 'tb') return state;
  const params = new URLSearchParams(serializeState(state));
  params.set(urlKeys[field], value);
  return parseLocation('', params.toString());
}
export function changeBan(state: OverlayState, team: Team, index: 0 | 1, value: string): { state: OverlayState; feedback: string } {
  if (value === 'TB') return { state, feedback: 'TB 不可 Ban，已阻止该选择。' };
  if (singleBanMods.includes(value) && state.banSlots[team][1 - index] === value) {
    return { state, feedback: `${teamNames[team]} 同一 mod 不可重复 Ban（NM/FM 例外），已阻止 ${value}。` };
  }
  if (!['unknown', 'empty', ...regularMods].includes(value)) return { state, feedback: '无效的 Ban 状态。' };
  const next = parseLocation('', serializeState(state));
  next.banSlots[team][index] = value as Ban;
  return { state: next, feedback: `${teamNames[team]} Ban ${index + 1}：${banLabel(value as Ban)}${value === 'unknown' ? '。' : '（本地演示）。'}` };
}
export function derive(state: OverlayState) {
  const meta = stages[state.stage];
  const format = state.mapType === 'tb' ? 'tb' : state.exTeam === 'none' ? 'normal' : 'ex';
  const ex = format === 'ex';
  const count = (state.mode === '4v4' ? 4 : 3) - (ex ? 1 : 0);
  const roster = (team: Team) => Array.from({ length: count }, (_, i) => ({
    team, id: `${team.toUpperCase()}${i + (ex ? 3 : 1)}`, slot: i + 1,
    role: ex ? `T${i + 2}` : ['Captain', 'T1', 'T2', 'T3'][i]!, syntheticEx: ex, name: null as string | null
  }));
  const arrived = (team: Team) => state.arrival === 'both' || state.arrival === team;
  const orderLabel = (value: 'unknown' | Team) => value === 'unknown' ? '未确认' : teamNames[value];
  const rematchLabel = (value: OverlayState['rematchA']) => value === 'used' ? '已用' : value === 'available' ? '可确认' : '未确认';
  const resultTotal = (values: number[]) => values.slice(0, count).reduce((sum, n) => sum + n, 0).toLocaleString('en-US');
  return {
    meta, seriesTarget: `${meta.format} · 先 ${meta.target}`, count, ex, format,
    formatLabel: { normal: '普通', ex: 'EX', tb: 'TB' }[format],
    modeLabel: ex ? `EX ${count}v${count}` : `${count}v${count}`,
    mod: state.mapType === 'tb' ? 'TB' : state.mapMod,
    exLabel: state.mapType === 'tb' ? 'TB · 禁 EX' : state.exTeam === 'none' ? 'EX 未开启' : `EX · ${teamNames[state.exTeam]}开启`,
    mapRule: state.mapType !== 'tb' && state.mapMod === 'FM' ? 'FM · 每队至少 1 名单HD（含 EZ/HDEZ） + 1 名单HR' : '',
    players: teams.flatMap(roster), roster, arrived, orderLabel,
    arrivalCount: (state.arrival === 'both' ? 2 : state.arrival === 'a' ? 1 : 0) * count,
    readiness: state.arrival === 'both' ? '双方选手已到场' : state.arrival === 'a' ? '示例A队已到场' : '等待选手到场',
    readinessCopy: state.arrival === 'both' ? '等待就绪确认。' : state.arrival === 'a' ? '示例B队等待中。' : '等待双方选手入场。',
    commentary: state.arrival === 'both' ? '双方选手已到场，等待就绪。' : state.arrival === 'a' ? '示例A队已到场，示例B队等待中。' : '等待双方选手入场。',
    scoreA: leadDemos[state.lead][0], scoreB: leadDemos[state.lead][1],
    resultA: resultTotal([350000, 320000, 300000, 280000]), resultB: resultTotal([330000, 310000, 290000, 260000]),
    pauseTitle: state.pauseType === 'tactical' ? '战术暂停' : '技术处理中',
    pauseTypeLabel: state.pauseType === 'tactical' ? '战术暂停' : '技术处理',
    pauseA: state.tacticalA === 'used' ? '已用' : '可用', pauseB: state.tacticalB === 'used' ? '已用' : '可用',
    rematch: `A ${rematchLabel(state.rematchA)} · B ${rematchLabel(state.rematchB)}`
  };
}
