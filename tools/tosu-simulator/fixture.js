import { randomUUID } from 'node:crypto';
import { newSession, transition } from '../../server/session/model.js';

// Entirely synthetic IDs/names. No real fixture, result, credential or API is used.
export const SIM_TEAMS = { left: '模拟红队', right: '模拟蓝队' };
export const SIM_POOL = [
  ...Array.from({ length: 7 }, (_, index) => ({ id: `sim-nm${index + 1}`, label: `NM${index + 1}`, mod: 'NM', beatmapId: 710001 + index })),
  { id: 'sim-hd1', label: 'HD1', mod: 'HD', beatmapId: 720001 },
  { id: 'sim-hd2', label: 'HD2', mod: 'HD', beatmapId: 720002 },
  { id: 'sim-hr1', label: 'HR1', mod: 'HR', beatmapId: 730001 },
  { id: 'sim-dt1', label: 'DT1', mod: 'DT', beatmapId: 740001 },
  { id: 'sim-fm1', label: 'FM1', mod: 'FM', beatmapId: 750001 },
  { id: 'sim-tb1', label: 'TB1', mod: 'TB', beatmapId: 760001 },
].map(entry => ({ ...entry, title: `模拟谱面 ${entry.label} · WebSocket 联动测试`, artist: '模拟艺术家', difficulty: '模拟难度' }));
export const WARMUP = { id: 'sim-warmup', label: '热身（池外）', mod: 'NM', beatmapId: 799999, title: '模拟热身 / 连接基线', artist: '模拟艺术家', difficulty: '模拟难度' };

export const seedCommands = () => [
  ['setup', { title: 'OCLR · 模拟 tosu WebSocket（非实机）', stage: 'group', mode: '4v4', source: '4x3',
    teams: Object.fromEntries(['a', 'b'].map((team, i) => [team, { id: `sim-team-${team}`, name: i === 0 ? SIM_TEAMS.left : SIM_TEAMS.right,
      roster: Array.from({ length: 4 }, (_, n) => ({ name: `SIM-${team.toUpperCase()}${n + 1}`, osuId: 900001 + i * 10 + n })) }])), pool: SIM_POOL }],
  ['arrival', { team: 'a', arrived: true, ready: true }],
  ['arrival', { team: 'b', arrived: true, ready: true }],
  ['roll', { a: 83, b: 52, winner: 'a', pickFirst: 'a', banFirst: 'a' }],
  // This is a declared test sequence, not a claim about official BP order.
  ['set-action', { action: { kind: 'ban', team: 'a', slot: 0 }, queue: [
    { kind: 'ban', team: 'b', slot: 0 }, { kind: 'pick', team: 'a' }, { kind: 'pick', team: 'b' },
  ] }],
  ['auto', { bp: true, scenes: true, locked: false, profile: 'stable-tourney', ...SIM_TEAMS }],
];

export function simulationSession() {
  return seedCommands().reduce((state, [type, payload]) => transition(state, { id: randomUUID(), version: state.version, type, payload }), newSession());
}
