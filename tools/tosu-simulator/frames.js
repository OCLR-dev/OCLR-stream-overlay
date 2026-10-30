import { SIM_POOL, SIM_TEAMS, WARMUP } from './fixture.js';

export const IPC_LABELS = ['Initialising', 'Idle', 'WaitingForClients', 'Playing', 'Ranking'];
const hits = { '0': 0, '50': 0, '100': 2, '300': 320, geki: 0, katu: 0, sliderBreaks: 0, sliderEndHits: 80, smallTickHits: 80, largeTickHits: 0 };
const stats = {
  stars: { live: 6.2, total: 6.2 }, ar: { original: 9.3, converted: 9.3 },
  cs: { original: 4, converted: 4 }, od: { original: 8.5, converted: 8.5 }, hp: { original: 5, converted: 5 },
  bpm: { realtime: 180, common: 180, min: 180, max: 180 },
  objects: { circles: 300, sliders: 180, spinners: 2, holds: 0, total: 482 }, hitWindow: {}, maxCombo: 800,
};
const mods = { name: 'NF', number: 1, array: ['NF'], rate: 1 };
// Explicit synthetic fixtures for the Playing card; never production defaults.
export const MAP_PARAM_PRESETS = {
  normal: { stats, time: { firstObject: 1000, lastObject: 180000, mp3Length: 182000 } },
  changed: { stats: { ...stats, stars: { live: 2.1, total: 7.35 }, cs: { original: 4, converted: 5.2 },
    ar: { original: 9, converted: 10.3 }, od: { original: 8, converted: 9.7 },
    bpm: { realtime: 240, common: 210.5, min: 150, max: 240 } },
    time: { firstObject: 2500, lastObject: 245000, mp3Length: 250000 } },
  partial: { stats: { stars: { live: 2.1 }, cs: { original: 4 }, ar: { converted: 9.8 },
    od: { converted: null }, bpm: { realtime: 180 } }, time: { firstObject: 1000, mp3Length: 182000 } },
  missing: { stats: null, time: {} },
  zero: { stats: { stars: { total: 0 }, cs: { converted: 0 }, ar: { converted: 0 },
    od: { converted: 0 }, bpm: { common: 0 } }, time: { lastObject: 0 } },
};
const play = (name, score, time) => ({
  failed: false, playerName: name, mode: { number: 0, name: 'osu!' }, score, accuracy: 98.65,
  healthBar: { normal: 100, smooth: 100 }, hits, hitErrorArray: [],
  combo: { current: Math.min(800, Math.floor(time / 200)), max: 800 }, mods,
  rank: { current: 'A', maxThisPlay: 'A' }, pp: { current: 120, fc: 150, maxAchieved: 120, maxAchievable: 160 }, unstableRate: 90,
});

export function initialRoom() {
  return { mapId: WARMUP.beatmapId, ipcState: 1, left: 0, right: 0, time: 0, growing: true, mapParams: 'normal',
    silent: false, invalid: false, wrongRoom: false, missingClient: false, clientsHidden: false, chatIndex: 0, chat: [] };
}

// Shape follows the tosu v2 fields consumed by src/tosu.js, including original
// tourney.team / totalScore / clients[].user + play (not normalized app state).
// Unused tosu settings/performance/files fields are intentionally omitted.
export function makeV2Frame(room, maps = [WARMUP, ...SIM_POOL]) {
  const params = MAP_PARAM_PRESETS[room.mapParams || 'normal'];
  const entry = maps.find(e => e.beatmapId === room.mapId) || {
    title: '模拟池外谱面', artist: '模拟艺术家', difficulty: '模拟难度', mod: 'NM',
  };
  const clients = Array.from({ length: 8 }, (_, index) => {
    const left = index < 4;
    const slot = index % 4;
    const total = left ? room.left : room.right;
    const score = total === null ? null : Math.floor(total / 4) + (slot === 3 ? total % 4 : 0);
    const name = `SIM-${left ? 'A' : 'B'}${slot + 1}`;
    return { ipcId: index, team: left ? 'left' : 'right', settings: { mania: { scrollSpeed: 28 } },
      user: { id: 900001 + (left ? 0 : 10) + slot, name, country: 'CN', accuracy: 98.65, rankedScore: 0, playCount: 1000, globalRank: 20000, totalPP: 5000 },
      beatmap: { stats: params.stats }, play: play(name, score, room.time) };
  });
  const ranking = room.ipcState === 4;
  return {
    simulation: true, game: { focused: true, paused: false }, client: 'stable', server: 'bancho',
    state: { number: ranking ? 7 : room.ipcState === 3 ? 2 : 5, name: ranking ? 'ResultsScreen' : room.ipcState === 3 ? 'Playing' : 'SongSelect' },
    session: { playTime: room.time, playCount: 1 },
    beatmap: { isKiai: false, isBreak: false, isConvert: false, id: room.mapId, set: 0, checksum: 'simulation-only',
      mode: { number: 0, name: 'osu!' }, status: { number: 4, name: 'Ranked' },
      artist: entry.artist, artistUnicode: entry.artist, title: entry.title, titleUnicode: entry.title,
      mapper: 'SIM Mapper', version: entry.difficulty, source: 'SIMULATOR', tags: 'simulation',
      time: { live: room.time, ...params.time }, stats: params.stats },
    play: clients[0].play,
    resultsScreen: ranking ? { ...clients[0].play, scoreId: 0, name: 'SIM', rank: 'A', maxCombo: 800, createdAt: '2026-10-28T00:00:00Z' } : null,
    tourney: { ipcState: room.ipcState, bestOF: 11, scoreVisible: true, starsVisible: true,
      team: { left: room.wrongRoom ? '错误房间（模拟）' : room.leftName || SIM_TEAMS.left, right: room.rightName || SIM_TEAMS.right },
      // Deliberately unrelated: the overlay must award from final totals, not mirror points.
      points: { left: 0, right: 0 }, totalScore: { left: room.left, right: room.right }, chat: room.chat,
      clients: room.clientsHidden ? [] : room.missingClient ? clients.slice(1) : clients },
  };
}
