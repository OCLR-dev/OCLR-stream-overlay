import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../server/session/store.js';
import { normalizeTosuV2 } from '../src/tosu.js';
import { liveBeatmap } from '../ui/liveScores.ts';
import { mapParameterDisplay } from '../ui/mapParameters.ts';

const nm = { stars: { total: 4 }, cs: { original: 4, converted: 4 }, hp: { original: 5, converted: 5 }, ar: { original: 8, converted: 8 }, od: { original: 7, converted: 7 }, bpm: { common: 180 } };
const hr = { ...nm, stars: { total: 5.5 }, cs: { original: 4, converted: 5.2 }, hp: { original: 5, converted: 7 }, ar: { original: 8, converted: 10 }, od: { original: 7, converted: 9.8 } };
const raw = (ipc = 3, stats: any[] = [hr, hr], id = 101, mod = 'HR') => ({ state: { number: 2, name: 'Playing' },
  beatmap: { id, checksum: 'same-file', stats: nm, time: { lastObject: 123000 } }, tourney: { ipcState: ipc, team: { left: 'L', right: 'R' }, totalScore: { left: 100, right: 90 },
    clients: stats.map((value, index) => ({ team: index ? 'right' : 'left', user: { id: index + 1 }, play: { mods: { name: mod } }, beatmap: { id, stats: value } })) } });
const absent = { bpm: { common: 180 } };
const values = (store: any, id = 101) => Object.fromEntries(mapParameterDisplay(id, 'tosu', liveBeatmap(store.snapshot(), 'synced'), null, 'HR').rows.map(row => [row.label, row.value]));
const expected = { '★': '5.5', CS: '5.2', HP: '7', AR: '10', OD: '9.8', BPM: '180', TIME: '2:03' };

test('Ranking retains the same observed Playing parameter snapshot when client difficulty fields clear, without changing raw stats or session', async () => {
  const store = new SessionStore();
  await store.frame(normalizeTosuV2(raw()), 1000);
  assert.deepEqual(values(store), expected);
  const session = JSON.stringify(store.state);
  const frame = normalizeTosuV2(raw(4, [absent, absent]));
  await store.frame(frame, 1100);
  assert.deepEqual(values(store), expected);
  assert.equal(frame.beatmap.tourneyStats.cs.converted, null);
  assert.equal(store.live.tosu.data.beatmap.tourneyStats.cs.converted, null);
  assert.equal(JSON.stringify(store.state), session, 'display retention never records a round or result');
  const copy = new SessionStore(); await copy.frame(normalizeTosuV2(raw(4, [absent, absent])), 1000);
  assert.equal(values(copy).CS, '—', 'joining Ranking cannot invent previous HR data');
});

test('partial and mixed free-mod snapshots remain whole, with no field-by-field HR or NM backfill', async () => {
  const store = new SessionStore(); await store.frame(normalizeTosuV2(raw()), 1000);
  await store.frame(normalizeTosuV2(raw(4, [hr, { ...nm, hp: hr.hp }])), 1100);
  const mixed = values(store); assert.equal(mixed.CS, '—'); assert.equal(mixed.HP, '7'); assert.equal(mixed.BPM, '180');
  await store.frame(normalizeTosuV2(raw(4, [absent, absent])), 1200);
  assert.deepEqual(values(store), mixed, 'a later missing row preserves the mixed snapshot, not earlier HR');
  const partial = new SessionStore();
  await partial.frame(normalizeTosuV2(raw(3, [{ ...hr, stars: { total: null } }, { ...hr, stars: { total: null } }])), 1000);
  await partial.frame(normalizeTosuV2(raw(4, [absent, absent])), 1100);
  assert.deepEqual(values(partial), { ...expected, '★': '—' }, 'known fields survive even when Playing itself had an unknown star rating');
});

test('wrong maps, files, mods, new Playing and disconnect cannot inherit a prior parameter snapshot', async () => {
  for (const kind of ['map', 'file', 'mod', 'playing', 'disconnect', 'session', 'incident', 'pause', 'mismatch', 'changed-attribute', 'gap', 'room', 'run']) {
    const store = new SessionStore(); await store.frame(normalizeTosuV2(raw()), 1000);
    const next = raw(4, [absent, absent]);
    if (kind === 'map') next.beatmap.id = 102;
    if (kind === 'file') next.beatmap.checksum = 'different-file';
    if (kind === 'mod') next.tourney.clients.forEach(c => { c.play.mods.name = 'DT'; });
    if (kind === 'playing') next.tourney.ipcState = 3;
    if (kind === 'disconnect') await store.sourceStatus('disconnected');
    if (kind === 'session') store.state.id = 'different-session';
    if (kind === 'incident') store.state.incident = { roundId: 'test', kind: 'unverified', reason: '', source: 'manual', at: '' };
    if (kind === 'pause') store.state.paused = true;
    if (kind === 'mismatch') next.tourney.clients[0]!.beatmap.id = 999;
    if (kind === 'changed-attribute') next.tourney.clients.forEach(c => { c.beatmap.stats = { ...absent, cs: { converted: 6 } } as any; });
    if (kind === 'room') next.tourney.team.left = 'New room';
    if (kind === 'run') {
      store.state.rounds = [{ id: 'new-run', runId: 'different', entryId: 'new-map', pickedBy: 'a', status: 'prepared' } as any];
      store.state.currentRoundId = 'new-run';
    }
    await store.frame(normalizeTosuV2(next), kind === 'gap' ? 7000 : 1100);
    assert.equal(values(store, next.beatmap.id).AR, '—', kind);
  }
});
