import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTosuV2 } from '../src/tosu.js';
import { SessionStore } from '../server/session/store.js';
import { liveBeatmap } from '../ui/liveScores.ts';
import { mapParameterDisplay } from '../ui/mapParameters.ts';

const nm = { stars: { total: 4.99 }, cs: { original: 5, converted: 5 }, hp: { original: 5, converted: 5 }, ar: { original: 8, converted: 8 }, od: { original: 7, converted: 7 }, bpm: { common: 175 } };
const hr = { ...nm, stars: { total: 5.71 }, cs: { original: 5, converted: 6.5 }, hp: { original: 5, converted: 7 }, ar: { original: 8, converted: 10 }, od: { original: 7, converted: 9.8 } };
const frame = (stats: any[] = [nm, hr, nm, hr], ipcState = 3) => ({ state: { number: 2, name: 'Playing' }, beatmap: { id: 101, checksum: 'fm-file', stats: nm, time: { lastObject: 138000 } },
  tourney: { ipcState, team: { left: 'L', right: 'R' }, clients: stats.map((value, index) => ({ team: index % 2 ? 'right' : 'left', user: { id: index + 1 }, play: { mods: { name: index % 2 ? 'HR' : 'NM' } }, beatmap: { id: 101, stats: value } })) } });
const display = (data: any, category = 'FM') => mapParameterDisplay(101, 'tosu', liveBeatmap({ live: { tosu: { status: 'live', data } } } as any, 'synced'), null, category);
const values = (result: ReturnType<typeof display>) => Object.fromEntries(result.rows.map(row => [row.label, row.value]));
const expected = { '★': '4.99–5.71', CS: '5–6.5', HP: '5–7', AR: '8–10', OD: '7–9.8', BPM: '175', TIME: '2:18' };

test('FM displays the full range of actual client values in Playing and Ranking, without changing common single-value stats', () => {
  for (const ipc of [3, 4]) {
    const data = normalizeTosuV2(frame(undefined, ipc));
    assert.deepEqual(values(display(data)), expected);
    assert.equal(data.beatmap.tourneyStats.cs.converted, null);
    assert.equal(values(display(data, 'HR')).CS, '—', 'other categories keep the common-value contract');
  }
});

test('FM equal values collapse to one number, including zero; missing attributes never become ranges from only some players', () => {
  const zero = { ...nm, cs: { original: 5, converted: 0 } };
  assert.equal(values(display(normalizeTosuV2(frame([zero, zero])))).CS, '0');
  const partial = { ...hr, ar: { original: 8, converted: null } };
  const actual = values(display(normalizeTosuV2(frame([nm, partial]))));
  assert.equal(actual.AR, '—'); assert.equal(actual.CS, '5–6.5');
  for (const stats of [[nm, null], []]) {
    const row = values(display(normalizeTosuV2(frame(stats))));
    for (const label of ['★', 'CS', 'HP', 'AR', 'OD', 'BPM']) assert.equal(row[label], '—');
  }
  const wrong = frame(); wrong.tourney.clients[1]!.beatmap.id = 999;
  assert.equal(values(display(normalizeTosuV2(wrong))).CS, '—');
});

test('FM ranges survive Ranking cleanup and output reload snapshots; new map and fresh Ranking cannot inherit them', async () => {
  const store = new SessionStore();
  await store.frame(normalizeTosuV2(frame()), 1000);
  const missing = frame(Array(4).fill({ bpm: { common: 175 } }), 4);
  await store.frame(normalizeTosuV2(missing), 1100);
  assert.deepEqual(values(display(store.snapshot().live.tosu.data)), expected);
  const fresh = new SessionStore(); await fresh.frame(normalizeTosuV2(missing), 1000);
  assert.equal(values(display(fresh.snapshot().live.tosu.data)).CS, '—');
  const next = normalizeTosuV2(missing); next.beatmap.id = 102;
  await store.frame(next, 1200);
  assert.ok(display(store.snapshot().live.tosu.data).rows.every(row => row.value === '—'));
});
