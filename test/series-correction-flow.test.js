import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../server/session/store.js';
import { currentRound, newSession, seriesOf, transition } from '../server/session/model.js';

function harness() {
  let state = newSession();
  const cmd = (type, payload = {}) => { state = transition(state, { id: randomUUID(), version: state.version, type, payload }); };
  cmd('setup', { title: '直接改分衔接 · 合成测试', stage: 'group', mode: '3v3', source: '4x3', teams: { a: { name: 'L', roster: [] }, b: { name: 'R', roster: [] } }, pool: [1, 2].map(i => ({ id: `m${i}`, label: `NM${i}`, mod: 'NM', beatmapId: i })) });
  cmd('bp'); cmd('set-action', { action: { kind: 'pick', team: 'a' }, queue: [{ kind: 'pick', team: 'b' }] }); cmd('apply-bp', { entryId: 'm1' });
  const store = new SessionStore({ state }); let now = 1000;
  return { store, get s() { return store.state; },
    cmd(type, payload = {}) { return store.command({ id: randomUUID(), version: store.state.version, type, payload }); },
    score(a, b) { return this.cmd('set-series', { a, b, reason: '直播员直接核对系列比分' }); },
    frame(ipc, map = 1, left = 900, right = 800) { return store.frame({ beatmap: { id: map }, tourney: { ipcState: ipc, teams: { left: 'L', right: 'R' }, totalScore: { left, right }, players: [{ side: 'left', osuId: 1, score: left }, { side: 'right', osuId: 2, score: right }] } }, now += 500); },
  };
}

test('direct score correction resolves a held finished map and continues BP without assigning a map winner', async () => {
  const h = harness(); await h.frame(1); await h.frame(3);
  await h.cmd('incident', { kind: 'spectator', reason: '观战异常，待结束后核对比分' }); await h.frame(4);
  await h.score(2, 1);
  assert.equal(h.s.incident, null); assert.equal(currentRound(h.s).status, 'ranking');
  assert.match(h.store.snapshot().live.note, /本图已处理/);
  assert.equal(currentRound(h.s).resultSource, 'series-correction'); assert.equal(currentRound(h.s).winner, null);
  assert.deepEqual(seriesOf(h.s), { a: 2, b: 1 }); assert.equal(h.s.action.kind, 'pick'); assert.equal(h.s.action.team, 'b');
  const action = structuredClone(h.s.action); await h.score(2, 2); assert.deepEqual(h.s.action, action);
  await h.frame(4); await h.frame(4); assert.deepEqual(seriesOf(h.s), { a: 2, b: 2 });
  await h.frame(1); await h.frame(1, 2); await h.frame(1, 2); assert.equal(currentRound(h.s).entryId, 'm2');
  await h.frame(3, 2); await h.frame(4, 2); await h.frame(4, 2);
  assert.deepEqual(seriesOf(h.s), { a: 3, b: 2 });
});

test('a display-only prepared map can be closed by direct score correction after an observed Playing to Ranking, without inventing a run', async () => {
  const h = harness(); await h.frame(3); await h.frame(4);
  assert.equal(currentRound(h.s).status, 'prepared'); assert.equal(currentRound(h.s).runId, null);
  await h.score(1, 0); assert.equal(currentRound(h.s).resultSource, 'series-correction');
  assert.equal(currentRound(h.s).runId, null); assert.equal(currentRound(h.s).winner, null); assert.equal(h.s.action.team, 'b');
});

test('correcting a series during Playing or before a replay starts does not end that map or clear an ongoing incident', async () => {
  const h = harness(); await h.frame(1); await h.frame(3);
  await h.cmd('incident', { kind: 'spectator', reason: '比赛仍在继续' }); await h.score(2, 1);
  assert.ok(h.s.incident); assert.equal(currentRound(h.s).status, 'playing'); assert.equal(h.s.action, null);
  await h.frame(1); await h.cmd('referee-replay', { reason: '裁判确认原图重赛' });
  await h.frame(4); await h.score(2, 2);
  assert.equal(currentRound(h.s).status, 'prepared'); assert.equal(currentRound(h.s).runId, null); assert.equal(h.s.action, null);
});

test('an explicit pause and a disconnected unconfirmed Playing remain protected when editing the series', async () => {
  for (const mode of ['pause', 'disconnect']) {
    const h = harness(); await h.frame(1); await h.frame(3);
    if (mode === 'pause') await h.cmd('pause', { kind: 'technical' }); else await h.store.sourceStatus('disconnected');
    await h.score(1, 0); assert.equal(currentRound(h.s).status, 'playing'); assert.equal(h.s.action, null);
    if (mode === 'pause') assert.equal(h.s.paused, true); else assert.ok(h.s.incident);
  }
});

test('a backup per-map record after an aggregate correction annotates the result without adding another series win', async () => {
  const h = harness(); await h.frame(1); await h.frame(3); await h.cmd('ranking'); await h.score(2, 1);
  await h.cmd('record-result', { roundId: currentRound(h.s).id, winner: 'a', keepDisplay: true });
  assert.deepEqual(seriesOf(h.s), { a: 2, b: 1 }); assert.equal(currentRound(h.s).winner, 'a');
});

test('explicitly re-entering the same series confirms a finished map once, and undo restores the held round', async () => {
  const h = harness(); await h.score(1, 0); await h.frame(1); await h.frame(3);
  await h.cmd('incident', { kind: 'spectator', reason: '等待人工核对' }); await h.frame(4);
  await h.score(1, 0); assert.equal(h.s.incident, null); assert.equal(h.s.action.team, 'b');
  const action = structuredClone(h.s.action); await h.score(1, 0); assert.deepEqual(h.s.action, action);
  await h.cmd('undo'); await h.cmd('undo');
  assert.ok(h.s.incident); assert.equal(currentRound(h.s).status, 'playing'); assert.equal(h.s.action, null);
  assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 });
});

test('the public score payload cannot force a running or unstarted round to finish', async () => {
  for (const playing of [false, true]) {
    const h = harness(); await h.frame(1); if (playing) await h.frame(3);
    await h.cmd('set-series', { a: 1, b: 0, reason: '核对系列分', finishRoundId: currentRound(h.s).id });
    assert.equal(currentRound(h.s).status, playing ? 'playing' : 'prepared'); assert.equal(h.s.action, null);
  }
});

test('display-only completion evidence expires across a source gap and cannot close a fresh replay', async () => {
  const h = harness(); await h.frame(3); await h.frame(4); await h.store.sourceStatus('disconnected');
  await h.frame(4); await h.score(1, 0);
  assert.equal(currentRound(h.s).status, 'prepared'); assert.equal(h.s.action, null);
});
