import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTosuV2 } from '../src/tosu.js';
import { liveBeatmap } from '../ui/liveScores.ts';
import { mapParameterDisplay } from '../ui/mapParameters.ts';
const original = { stars: { total: 4.99 }, cs: { original: 5, converted: 5 }, hp: { original: 5, converted: 5 }, ar: { original: 8, converted: 8 }, od: { original: 7, converted: 7 }, bpm: { common: 180 }, objects: { total: 528 }, maxCombo: 819 };
const hr = { ...original, stars: { total: 5.71 }, cs: { original: 5, converted: 6.5 }, hp: { original: 5, converted: 7 }, ar: { original: 8, converted: 10 }, od: { original: 7, converted: 9.8 } };
function frame(stats: any[] = [hr, hr], ipcState = 3) {
  return { state: { number: 2, name: 'Playing' }, beatmap: { id: 4556723, stats: original }, tourney: { ipcState,
    team: { left: 'L', right: 'R' }, clients: stats.map((value, index) => ({ team: index % 2 ? 'right' : 'left', user: { id: index + 1 }, play: { mods: { name: 'HRNFv2' } }, beatmap: { stats: value } })) } };
}
function display(raw: any) {
  const data = normalizeTosuV2(raw);
  const envelope = { live: { tosu: { status: 'live', data } } } as any;
  const map = liveBeatmap(envelope, 'synced');
  return { data, values: Object.fromEntries(mapParameterDisplay(4556723, 'tosu', map, null, 'HR').rows.map(row => [row.label, row.value])) };
}
test('real tourney HR parameters come from clients rather than root NM stats in Playing and Ranking', () => {
  for (const ipc of [3, 4]) {
    const { data, values } = display(frame([hr, hr, hr, hr, hr, hr], ipc));
    assert.equal(data.beatmap.stats.cs.converted, 5, 'source NM stats remain intact');
    assert.deepEqual(values, { '★': '5.71', CS: '6.5', HP: '7', AR: '10', OD: '9.8', BPM: '180', 时长: '—' });
  }
});
test('DT client star, timing attributes and BPM are read without applying mods twice', () => {
  const dt = { ...original, stars: { total: 6.12 }, ar: { original: 8, converted: 9.67 }, od: { original: 7, converted: 9.08 }, bpm: { common: 270 } };
  const { values } = display(frame([dt, dt]));
  assert.equal(values['★'], '6.12'); assert.equal(values.AR, '9.67'); assert.equal(values.BPM, '270');
});
test('mixed free-mod rows show only common attributes; missing clients never backfill root NM values', () => {
  const mixed = display(frame([hr, original])).values;
  for (const key of ['★', 'CS', 'HP', 'AR', 'OD']) assert.equal(mixed[key], '—');
  assert.equal(mixed.BPM, '180');
  for (const samples of [[hr, null], [null, null], []]) {
    assert.ok(Object.values(display(frame(samples)).values).every(value => value === '—'));
  }
});
test('an explicitly mismatched client map or base attributes cannot be displayed as this map', () => {
  const raw = frame(); raw.tourney.clients[1].beatmap = { ...raw.tourney.clients[1].beatmap, id: 999 } as any;
  assert.equal(display(raw).values.CS, '—');
  assert.equal(display(frame([hr, { ...hr, ar: { original: 9, converted: 10 } }])).values.CS, '—');
});
test('Idle still uses selected map stats; absent new telemetry stays compatible and zero is preserved', () => {
  assert.equal(display(frame([hr, hr], 1)).values.CS, '5');
  assert.equal(display(frame([{ ...hr, cs: { original: 5, converted: 0 } }, { ...hr, cs: { original: 5, converted: 0 } }])).values.CS, '0');
  const data = normalizeTosuV2(frame()); delete data.beatmap.tourneyStats;
  const map = liveBeatmap({ live: { tosu: { status: 'live', data } } } as any, 'synced');
  assert.equal(map?.stats?.cs.converted, 5);
});
