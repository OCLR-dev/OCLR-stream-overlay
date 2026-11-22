import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../server/session/store.js';
import { currentRound, newSession, seriesOf } from '../server/session/model.js';
import { normalizeTosuV2 } from '../src/tosu.js';
import { liveTeamScores, resultTeamScores } from '../ui/liveScores.ts';
import { retainRankingScores } from '../ui/rankingScoreHold.ts';

const chartObjects = 6;
const zeroes = Array(8).fill(0);
const mapEntries = [
  { id: 'NM1', label: 'NM1', mod: 'NM', beatmapId: 101 },
  { id: 'NM2', label: 'NM2', mod: 'NM', beatmapId: 102 },
  { id: 'NM3', label: 'NM3', mod: 'NM', beatmapId: 103 },
  { id: 'FM1', label: 'FM1', mod: 'FM', beatmapId: 104 },
];

function match(t) {
  const state = newSession();
  state.pool = mapEntries;
  const store = new SessionStore({ state });
  t.after(() => store.close());
  let at = 1000;
  const cmd = (type, payload) => store.command({ id: crypto.randomUUID(), version: store.state.version, type, payload });
  const prepare = async (index, ex = false) => {
    await cmd('prepare-round', { entryId: mapEntries[index].id, pickedBy: 'a' });
    if (ex) await cmd('ex', { team: 'a', remaining: store.state.ex.remaining });
  };
  const feed = (ipcState, scores = zeroes, opts = {}) => {
    const { map = store.state.pool.find(entry => entry.id === currentRound(store.state)?.entryId)?.beatmapId,
      counts = Array(8).fill(ipcState === 4 ? chartObjects : 0), ez = false, scoreVisible = true,
      missing, replacement, wrongSide } = opts;
    const clients = scores.map((score, ipcId) => ({
      ipcId, team: (ipcId < 4) !== (ipcId === wrongSide) ? 'left' : 'right',
      user: { id: ipcId === replacement ? 99 : ipcId + 1 },
      play: { score, mods: { name: ez && ipcId === 0 ? 'NFEZ' : 'NF' },
        hits: { '0': 0, '50': 0, '100': 0, '300': counts[ipcId] } },
    })).filter(c => c.ipcId !== missing).reverse();
    const frame = normalizeTosuV2({ state: { number: 2 }, beatmap: { id: map, stats: { objects: { total: chartObjects } } },
      tourney: { ipcState, scoreVisible, team: { left: 'Red', right: 'Blue' },
        totalScore: { left: scores.slice(0, 4).reduce((a, b) => a + b, 0), right: scores.slice(4).reduce((a, b) => a + b, 0) }, clients },
    });
    return store.frame(frame, at += 500);
  };
  return { store, cmd, prepare, feed, get round() { return currentRound(store.state); } };
}

const live = snapshot => liveTeamScores(snapshot, 'synced');
const projected = snapshot => snapshot.live.tosu.data.tourney.competitionScore;

test('4v4 → EX → 4v4 excludes residual slots only for the EX run and records the corrected winner once', async t => {
  const m = match(t);
  await m.prepare(0);
  await m.feed(1); await m.feed(3);
  const previous = [20, 20, 20, 100, 10, 10, 10, 900];
  await m.feed(4, previous); await m.feed(4, previous);
  assert.deepEqual(m.round.finalScore, { a: 160, b: 930 });

  await m.prepare(1, true);
  await m.feed(1, previous);
  let frame = await m.feed(3, previous, { counts: Array(8).fill(chartObjects) });
  assert.deepEqual(live(frame), { left: null, right: null }, 'the first Playing frame still contains the previous game');
  frame = await m.feed(3, [0, 0, 0, 100, 0, 0, 0, 900]);
  assert.deepEqual(live(frame), { left: 0, right: 0 });
  const final = [200, 180, 140, 100, 110, 100, 90, 900];
  frame = await m.feed(3, final, { counts: Array(8).fill(4) });
  assert.deepEqual(live(frame), { left: 520, right: 300 });
  await m.cmd('setting', { field: 'mode', value: '3v3' });
  assert.deepEqual(live(m.store.snapshot()), { left: 520, right: 300 }, 'changing the next layout does not change how the started run scores');
  await m.cmd('setting', { field: 'mode', value: '4v4' });
  assert.deepEqual(projected(frame).rawTotalScore, { left: 620, right: 1200 });
  assert.deepEqual(projected(frame).players.map(player => player.ipcId), [0, 1, 2, 4, 5, 6]);
  const early = { counts: [6, 6, 6, 6, 6, 6, 5, 6] };
  await m.feed(4, final, early); frame = await m.feed(4, final, early);
  assert.deepEqual(resultTeamScores(frame, 'synced'), { left: 520, right: null });
  assert.equal(m.round.status, 'ranking');
  assert.deepEqual(seriesOf(m.store.state), { a: 0, b: 1 });

  await m.feed(4, final);
  const residualChanges = [...final.slice(0, 7), 950];
  frame = await m.feed(4, residualChanges);
  assert.deepEqual(m.round.finalScore, { a: 520, b: 300 });
  assert.equal(m.round.winner, 'a');
  assert.equal(m.round.scoreCalculation.rule, 'ex-slots');
  assert.deepEqual(retainRankingScores(frame, 'synced', 'playing', null).scores, { left: 520, right: 300 });
  await m.feed(4, final);
  await m.feed(4, zeroes, { scoreVisible: false, counts: zeroes });
  assert.equal(m.store.state.incident, null);
  assert.deepEqual(seriesOf(m.store.state), { a: 1, b: 1 });

  await m.prepare(2);
  await m.feed(1); frame = await m.feed(3, [40, 40, 40, 10, 20, 20, 20, 200]);
  assert.equal(projected(frame).rule, 'client');
  assert.deepEqual(live(frame), { left: 130, right: 260 });
});

test('EX FM applies EZ to active players and does not reuse a same-map replay baseline', async t => {
  const m = match(t);
  await m.prepare(3, true);
  await m.feed(1); await m.feed(3);
  const scores = [201, 40, 40, 900, 150, 120, 100, 800];
  let frame = await m.feed(3, scores, { ez: true, counts: Array(8).fill(3) });
  assert.deepEqual(live(frame), { left: 382, right: 370 });
  const incomplete = { ez: true, counts: [3, 3, 3, 6, 3, 3, 3, 6] };
  await m.feed(4, scores, incomplete); await m.feed(4, scores, incomplete);
  assert.equal(m.round.status, 'ranking');
  const previousId = m.round.id;
  await m.cmd('replay', { reason: '裁判确认重赛' });
  assert.notEqual(m.round.id, previousId);
  await m.feed(1, scores, incomplete);
  frame = await m.feed(3, scores, incomplete);
  assert.deepEqual(live(frame), { left: null, right: null });
  await m.feed(3); await m.feed(4, scores, { ez: true }); await m.feed(4, scores, { ez: true });
  assert.equal(m.round.winner, 'a');
  const changed = [201, 40, 40, 900, 150, 150, 100, 800];
  await m.feed(4, changed, { ez: true, scoreVisible: false });
  assert.equal(m.round.status, 'ranking', 'a changed active score still triggers a result review');
  assert.equal(m.store.state.incident?.kind, 'unverified');
  assert.deepEqual(seriesOf(m.store.state), { a: 0, b: 0 });
});

test('EX waits for all fixed players and never replaces a locked participant during play', async t => {
  const m = match(t);
  await m.prepare(1, true);
  await m.feed(1);
  let frame = await m.feed(3, zeroes, { wrongSide: 2 });
  assert.deepEqual(live(frame), { left: null, right: 0 });
  frame = await m.feed(3);
  assert.deepEqual(live(frame), { left: 0, right: 0 });
  const scores = [70, 60, 80, 900, 50, 50, 50, 800];
  frame = await m.feed(3, scores, { replacement: 2 });
  assert.deepEqual(live(frame), { left: null, right: 150 });
  assert.equal(m.store.state.incident?.kind, 'unverified');
  await m.feed(4, scores, { missing: 2 }); await m.feed(4, scores, { replacement: 2 });
  assert.deepEqual(seriesOf(m.store.state), { a: 0, b: 0 });
});
