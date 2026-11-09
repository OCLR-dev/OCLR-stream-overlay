import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { competitionScore } from '../server/session/scoring.js';
import { resultFacts } from '../server/session/room-facts.js';
import { SessionStore } from '../server/session/store.js';
import { newSession, currentRound, seriesOf } from '../server/session/model.js';
import { normalizeTosuV2 } from '../src/tosu.js';
import { liveTeamScores, resultTeamScores } from '../ui/liveScores.ts';
import { retainRankingScores } from '../ui/rankingScoreHold.ts';
import { scoreDifference } from '../ui/scoreDifference.ts';

const entry = (id = 101, mod = 'FM') => ({ id: `${mod}${id}`, beatmapId: id, mod, label: `${mod}1`, title: '', artist: '', difficulty: '' });
const player = (id, side, score, mods = 'NF') => ({ osuId: id, side, score, mods });
const members = () => [player(1, 'left', 400000, 'NFEZ'), player(2, 'right', 500000)];
function sample(ipcState = 3, players = members(), map = 101) {
  return normalizeTosuV2({ state: { number: 2 }, beatmap: { id: map }, tourney: {
    ipcState, scoreVisible: true, team: { left: 'L', right: 'R' },
    totalScore: Object.fromEntries(['left', 'right'].map(side => [side, players.filter(p => p.side === side).reduce((sum, p) => sum + p.score, 0)])),
    clients: players.map(p => ({ team: p.side, user: { id: p.osuId }, play: { score: p.score, mods: { name: p.mods } } })),
  } });
}
function fixture() {
  const state = newSession(); state.pool = [entry(), entry(102, 'NM')];
  return state;
}
function harness(t) {
  const store = new SessionStore({ state: fixture() }); t.after(() => store.close());
  let now = 1000;
  return { store,
    cmd: (type, payload = {}) => store.command({ id: crypto.randomUUID(), version: store.state.version, type, payload }),
    feed: (ipc = 3, players = members(), map = 101, patch = {}) => {
      const frame = sample(ipc, players, map); Object.assign(frame.tourney, patch);
      return store.frame(frame, now += 500);
    },
    async prepare() { await this.cmd('prepare-round', { entryId: entry().id, pickedBy: 'a' }); await this.feed(1); await this.feed(3); },
    async finish() { await this.feed(4); await this.feed(4); },
  };
}

test('FM compensates the client score once, keeps source facts intact and reverses the winner', () => {
  const state = fixture(); const frame = sample(); const before = structuredClone(frame);
  const score = competitionScore(state, frame);
  assert.deepEqual(score.totalScore, { left: 600000, right: 500000 });
  assert.deepEqual(score.rawTotalScore, { left: 400000, right: 500000 });
  assert.equal(resultFacts(frame.tourney).complete, true);
  assert.deepEqual(frame, before);
  assert.deepEqual(competitionScore(state, frame), score);
});

for (const mods of ['EZ', 'HDEZ', 'EZHD', 'NFHDEZ', 'NF + HD + EZ', 'ez']) test(`actual ${mods} gets the EZ multiplier`, () => {
  assert.equal(competitionScore(fixture(), sample(3, [player(1, 'left', 401, mods), player(2, 'right', 500)])).totalScore.left, 602);
});

test('rounding is per player, multiple EZ players add, and valid zero remains zero', () => {
  const score = competitionScore(fixture(), sample(3, [player(1, 'left', 1, 'EZ'), player(2, 'left', 1, 'HDEZ'),
    player(3, 'left', 700000), player(4, 'right', 0, 'EZ')]));
  assert.deepEqual(score.totalScore, { left: 700004, right: 0 });
});

for (const mod of ['NM', 'HD', 'HR', 'DT', 'TB']) test(`${mod} does not receive FM EZ compensation`, () => {
  const state = fixture(); state.pool = [entry(101, mod)];
  assert.deepEqual(competitionScore(state, sample()).totalScore, { left: 400000, right: 500000 });
});

for (const mods of [null, '', 'unknown', 'not-EZ']) test(`missing or invalid Mods ${String(mods)} cannot become an unadjusted FM score`, () => {
  const score = competitionScore(fixture(), sample(3, [player(1, 'left', 400000, mods), player(2, 'right', 500000)]));
  assert.equal(score.totalScore.left, null); assert.equal(score.totalScore.right, 500000); assert.ok(score.reason);
});

test('FM rejects missing, inconsistent, duplicate, unassigned and unsafe score inputs', () => {
  const changes = [
    frame => { frame.tourney.players[0].score = null; },
    frame => { frame.tourney.totalScore.left = null; },
    frame => { frame.tourney.totalScore.left++; },
    frame => { frame.tourney.players.push({ ...frame.tourney.players[0] }); },
    frame => { frame.tourney.players[0].side = null; },
    frame => { frame.tourney.players[0].score = Number.MAX_SAFE_INTEGER; frame.tourney.totalScore.left = Number.MAX_SAFE_INTEGER; },
  ];
  for (const change of changes) {
    const frame = sample(); change(frame);
    assert.equal(competitionScore(fixture(), frame).totalScore.left, null);
  }
});

test('unknown/ambiguous pool slots explicitly expose raw scores; a matching round disambiguates them', () => {
  const state = fixture(); const frame = sample(); state.pool.push(entry(101, 'NM'));
  const unknown = competitionScore(state, frame);
  assert.equal(unknown.rule, 'unknown'); assert.ok(unknown.reason);
  assert.deepEqual(unknown.totalScore, frame.tourney.totalScore);
  state.currentRoundId = 'round'; state.rounds = [{ id: 'round', entryId: entry().id, status: 'playing' }];
  assert.equal(competitionScore(state, frame).totalScore.left, 600000);
  frame.beatmap.id = 999;
  assert.equal(competitionScore(state, frame).rule, 'unknown');
});

test('published totals drive live display, difference, saved Ranking, win and reload without double compensation', async t => {
  const h = harness(t); await h.prepare();
  const live = h.store.snapshot();
  assert.deepEqual(liveTeamScores(live, 'synced'), { left: 600000, right: 500000 });
  assert.deepEqual(live.live.tosu.data.tourney.totalScore, { left: 400000, right: 500000 });
  const displayed = liveTeamScores(live, 'synced');
  assert.deepEqual(scoreDifference(String(displayed.left), String(displayed.right)), { delta: 100000, scale: -0.4 });
  await h.finish();
  const round = currentRound(h.store.state);
  assert.deepEqual(round.finalScore, { a: 600000, b: 500000 }); assert.equal(round.winner, 'a');
  assert.deepEqual(seriesOf(h.store.state), { a: 1, b: 0 });
  assert.equal(round.scoreCalculation.players[0].rawScore, 400000);
  const snapshot = h.store.snapshot();
  assert.deepEqual(resultTeamScores(snapshot, 'synced'), { left: 600000, right: 500000 });
  let hold = retainRankingScores(snapshot, 'synced', 'playing', null);
  assert.deepEqual(hold.scores, { left: 600000, right: 500000 });
  for (let i = 0; i < 3; i++) await h.feed(4);
  assert.deepEqual(seriesOf(h.store.state), { a: 1, b: 0 }); assert.equal(h.store.state.incident, null);
  await h.feed(4, members(), 101, { totalScore: { left: 0, right: 0 }, scoreVisible: false });
  hold = retainRankingScores(h.store.snapshot(), 'synced', 'playing', hold);
  assert.deepEqual(hold.scores, { left: 600000, right: 500000 }); assert.equal(h.store.state.incident, null);
  const dir = await mkdtemp(join(tmpdir(), 'oclr-fm-ez-')); t.after(() => rm(dir, { recursive: true, force: true }));
  h.store.file = join(dir, 'session.json'); await h.store.save(h.store.state);
  const restored = await SessionStore.open(h.store.file); t.after(() => restored.close());
  assert.deepEqual(currentRound(restored.state).scoreCalculation, round.scoreCalculation);
  assert.deepEqual(resultTeamScores(restored.snapshot(), 'disconnected'), { left: 600000, right: 500000 });
});

test('joining FM mid-map gets compensated totals without creating a run or backfilling a win', async t => {
  const h = harness(t); await h.feed();
  assert.equal(liveTeamScores(h.store.snapshot(), 'synced').left, 600000);
  await h.finish();
  const hold = retainRankingScores(h.store.snapshot(), 'synced', 'playing', null);
  assert.equal(hold.scores.left, 600000);
  assert.equal(h.store.state.rounds.length, 0); assert.deepEqual(seriesOf(h.store.state), { a: 0, b: 0 });
  await h.store.sourceStatus('disconnected');
  assert.equal(liveTeamScores(h.store.snapshot(), 'synced'), null);
  assert.deepEqual(retainRankingScores(h.store.snapshot(), 'disconnected', 'playing', hold).scores, { left: 600000, right: 500000 });
  await h.feed(4); await h.feed(4); assert.equal(h.store.state.rounds.length, 0);
});

test('FM waits for Mods; recovered data must stabilize before the compensated result can win', async t => {
  const h = harness(t); await h.prepare();
  const missing = [player(1, 'left', 400000, null), player(2, 'right', 500000)];
  await h.feed(4, missing); await h.feed(4, missing);
  assert.equal(currentRound(h.store.state).status, 'ranking');
  assert.deepEqual(seriesOf(h.store.state), { a: 0, b: 0 });
  assert.equal(liveTeamScores(h.store.snapshot(), 'synced').left, null);
  assert.match(h.store.snapshot().live.note, /Mods/);
  await h.feed(4); assert.equal(currentRound(h.store.state).status, 'ranking');
  await h.feed(4); assert.equal(currentRound(h.store.state).winner, 'a');
});

test('a Mods-only change resets the candidate even when client totals are unchanged', async t => {
  const h = harness(t); await h.prepare(); await h.feed(4);
  const changed = [player(1, 'left', 400000, 'NF'), player(2, 'right', 500000)];
  await h.feed(4, changed); assert.equal(currentRound(h.store.state).status, 'ranking');
  await h.feed(4, changed); assert.equal(currentRound(h.store.state).winner, 'b');
});

test('late changed scores/Mods retract the compensated win; manual corrections stay protected', async t => {
  for (const kind of ['score', 'mods']) {
    const h = harness(t); await h.prepare(); await h.finish();
    const changed = kind === 'score' ? [player(1, 'left', 410000, 'EZ'), player(2, 'right', 500000)]
      : [player(1, 'left', 400000), player(2, 'right', 500000)];
    await h.feed(4, changed);
    assert.ok(h.store.state.incident, kind); assert.deepEqual(seriesOf(h.store.state), { a: 0, b: 0 });
    await h.cmd('record-result', { roundId: currentRound(h.store.state).id, winner: 'b', reviewReason: '测试人工核对' });
    await h.feed(4); await h.feed(4); assert.deepEqual(seriesOf(h.store.state), { a: 0, b: 1 });
  }
});

test('the next NM map cannot inherit an FM multiplier or held Ranking pair', async t => {
  const h = harness(t); await h.prepare(); await h.finish();
  const hold = retainRankingScores(h.store.snapshot(), 'synced', 'playing', null);
  await h.feed(1); assert.equal(retainRankingScores(h.store.snapshot(), 'synced', 'mappool', hold), null);
  await h.cmd('prepare-round', { entryId: entry(102, 'NM').id, pickedBy: 'b' });
  await h.feed(1, members(), 102); await h.feed(3, members(), 102);
  assert.deepEqual(liveTeamScores(h.store.snapshot(), 'synced'), { left: 400000, right: 500000 });
  assert.equal(retainRankingScores(h.store.snapshot(), 'synced', 'playing', hold), null);
});


test('an explicit replay starts without old scoring evidence and computes the new Mods independently', async t => {
  const h = harness(t); await h.prepare(); await h.finish();
  const old = currentRound(h.store.state);
  await h.cmd('retract-result', { roundId: old.id, reason: '测试裁判确认重赛' });
  await h.cmd('replay', { reason: '测试裁判确认重赛' });
  assert.equal(currentRound(h.store.state).scoreCalculation, undefined);
  const changed = [player(1, 'left', 400000), player(2, 'right', 500000, 'EZ')];
  await h.feed(1, changed); await h.feed(3, changed); await h.feed(4, changed); await h.feed(4, changed);
  assert.deepEqual(currentRound(h.store.state).finalScore, { a: 400000, b: 750000 });
  assert.deepEqual(seriesOf(h.store.state), { a: 0, b: 1 });
  assert.deepEqual(old.scoreCalculation.totalScore, { left: 600000, right: 500000 });
});


test('FM without EZ preserves both team totals and the ordinary winner', () => {
  const frame = sample(3, [player(1, 'left', 700000, 'NFHD'), player(2, 'right', 800000, 'NFHR')]);
  assert.deepEqual(competitionScore(fixture(), frame).totalScore, frame.tourney.totalScore);
});
