import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTosuV2 } from '../src/tosu.js';
import { SessionStore } from '../server/session/store.js';
import { liveBeatmap } from '../ui/liveScores.ts';
import { mapParameterDisplay } from '../ui/mapParameters.ts';

const stats = { stars: { total: 6 }, cs: { original: 4, converted: 4 }, hp: { original: 5, converted: 5 },
  ar: { original: 8, converted: 10 }, od: { original: 7, converted: 9 }, bpm: { common: 270 } };
const raw = (mods: any = { name: 'DT', number: 64, rate: 1.5 }, ipcState = 3) => ({ state: { number: 2, name: 'Playing' },
  beatmap: { id: 101, checksum: 'duration-file', time: { lastObject: 180000 }, stats },
  play: { mods: { name: 'NM', rate: 1 } }, tourney: { ipcState, team: { left: 'L', right: 'R' },
    clients: [0, 1].map(i => ({ team: i ? 'right' : 'left', user: { id: i + 1 }, play: { mods }, beatmap: { id: 101, stats } })) } });
const display = (data: any, category = 'DT') => mapParameterDisplay(101, 'tosu', liveBeatmap({ live: { tosu: { status: 'live', data } } } as any, 'synced'), null, category);
const values = (data: any, category = 'DT') => Object.fromEntries(display(data, category).rows.map(row => [row.label, row.value]));

test('DT and NC duration follows actual client rate once; converted BPM and AR/OD are untouched', () => {
  for (const mods of [{ name: 'DT', number: 64, rate: 1.5 }, { name: 'NFDTv2' }, { number: 576 }, { name: 'NC' }]) {
    for (const ipc of [3, 4]) {
      const row = values(normalizeTosuV2(raw(mods, ipc)));
      assert.equal(row.TIME, '2:00'); assert.equal(row.BPM, '270'); assert.equal(row.AR, '10'); assert.equal(row.OD, '9');
    }
  }
});

test('explicit custom rates override DT defaults; neutral and half-time mods keep their actual duration', () => {
  for (const [mods, expected] of [[{ name: 'DT', rate: 1.2 }, '2:30'], [{ name: 'HDHR', rate: 1 }, '3:00'], [{ name: 'HT' }, '4:00']]) {
    assert.equal(values(normalizeTosuV2(raw(mods))).TIME, expected);
  }
  const solo = raw(); (solo as any).tourney = null; solo.play.mods = { name: 'DT', rate: 1.5 };
  assert.equal(values(normalizeTosuV2(solo)).TIME, '2:00');
});

test('FM mixed playback rates show the actual shortest-to-longest duration, while fixed categories keep mixed rates unknown', () => {
  const frame = raw(); frame.tourney.clients[1]!.play.mods = { name: 'HT', rate: 0.75 };
  const data = normalizeTosuV2(frame);
  assert.equal(values(data, 'FM').TIME, '2:00–4:00');
  assert.equal(values(data, 'DT').TIME, '—');
  for (const rate of [0, -1, NaN]) assert.equal(values(normalizeTosuV2(raw({ name: 'DT', rate }))).TIME, '—');
});

test('Ranking cleanup retains the observed DT rate and a new map cannot inherit it', async () => {
  const store = new SessionStore(); await store.frame(normalizeTosuV2(raw()), 1000);
  const empty = raw(); empty.tourney.ipcState = 4;
  empty.tourney.clients.forEach(c => { c.beatmap.stats = { bpm: { common: 270 } } as any; });
  await store.frame(normalizeTosuV2(empty), 1100);
  assert.equal(values(store.snapshot().live.tosu.data).TIME, '2:00');
  empty.tourney.clients.forEach(c => { c.play.mods = { name: '', number: 0, rate: 1 }; });
  await store.frame(normalizeTosuV2(empty), 1150);
  assert.equal(values(store.snapshot().live.tosu.data).TIME, '2:00', 'cleared NM placeholders cannot replace the observed DT rate');
  const next = normalizeTosuV2(empty); next.beatmap.id = 102;
  await store.frame(next, 1200); assert.ok(display(store.snapshot().live.tosu.data).rows.every(row => row.value === '—'));
});

test('simulation duration uses the verified calculation clock rate only with matching live timing', () => {
  const data = normalizeTosuV2(raw());
  const map = liveBeatmap({ live: { tosu: { status: 'live', data } } } as any, 'synced');
  const metadata = { beatmapId: 101, source: 'osu-file' as const, stats: { cs: 4, hp: 5, ar: 8, od: 7, bpm: { min: 180, max: 180 } },
    calculation: { mod: 'DT', stars: 6, cs: 4, hp: 5, ar: 10, od: 9, clockRate: 1.5, bpm: { min: 270, max: 270 } } };
  const duration = (live: any) => mapParameterDisplay(101, 'official-test', live, metadata, 'DT').rows.find(row => row.label === 'TIME')!.value;
  assert.equal(duration(map), '2:00'); assert.equal(duration({ ...map, id: 102 }), '—'); assert.equal(duration(null), '—');
});
