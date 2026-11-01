import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../server/session/store.js';
import { currentRound, newSession, seriesOf, transition } from '../server/session/model.js';

function harness(state) {
  const command = (s, type, payload) => transition(s, { id: randomUUID(), version: s.version, type, payload });
  if (!state) {
    state = command(newSession(), 'setup', { title: '重赛接回 · 合成测试', stage: 'group', mode: '3v3', source: '4x3',
      teams: { a: { name: 'L', roster: [] }, b: { name: 'R', roster: [] } },
      pool: [1, 2].map(i => ({ id: `m${i}`, label: `NM${i}`, mod: 'NM', beatmapId: i })) });
    state = command(state, 'bp', {});
    state = command(state, 'set-action', { action: { kind: 'pick', team: 'a' }, queue: [{ kind: 'pick', team: 'b' }] });
    state = command(state, 'apply-bp', { entryId: 'm1' });
  }
  const store = new SessionStore({ state }); let now = 1000;
  return { store, get s() { return store.state; },
    advance(ms) { now += ms; },
    cmd(type, payload = {}) { return store.command({ id: randomUUID(), version: store.state.version, type, payload }); },
    frame(ipc, ids = [1, 2], map = 1, left = 900, right = 800) {
      return store.frame({ beatmap: { id: map }, tourney: { ipcState: ipc, teams: { left: 'L', right: 'R' }, totalScore: { left, right },
        players: [{ side: 'left', osuId: ids[0], score: left }, { side: 'right', osuId: ids[1], score: right }] } }, now += 500);
    },
  };
}

for (const loading of [[3], [0, 3, 3]]) test(`referee replay clicked at ready survives temporary empty player IDs during startup ${loading}`, async () => {
  const h = harness(); await h.frame(1); await h.frame(3);
  const old = structuredClone(currentRound(h.s));
  await h.frame(1); assert.ok(h.s.incident);
  await h.cmd('referee-replay', { reason: '裁判 abort 后重新 ready，确认同图重赛' });
  const selected = structuredClone(currentRound(h.s)); const bp = structuredClone(h.s.bpHistory);
  assert.equal(selected.replayOf, old.id); assert.equal(h.s.incident, null);
  for (const ipc of loading) { await h.frame(ipc, [0, 0]); assert.equal(currentRound(h.s).status, 'prepared'); }
  await h.frame(3);
  assert.equal(currentRound(h.s).status, 'playing'); assert.notEqual(currentRound(h.s).runId, old.runId);
  assert.equal(currentRound(h.s).id, selected.id); assert.deepEqual(h.s.bpHistory, bp);
  assert.equal(h.s.rounds.find(r => r.id === old.id).status, 'void');
  await h.frame(4); await h.frame(4); assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 });
  assert.equal(currentRound(h.s).resultSource, 'tosu');
  const version = h.s.version; await h.frame(4); assert.equal(h.s.version, version);
  await h.frame(1); await h.frame(1, [0, 0], 2); await h.frame(1, [0, 0], 2);
  assert.equal(currentRound(h.s).entryId, 'm2'); assert.equal(currentRound(h.s).pickedBy, 'b');
});

test('replay remains unstarted with one invalid side; no score or next BP is inferred until both sides recover', async () => {
  const h = harness(); await h.frame(1); await h.frame(3); await h.frame(1);
  await h.cmd('referee-replay', { reason: '裁判确认' });
  await h.frame(3, [1, 0]); await h.frame(3, [1, 0]);
  assert.equal(currentRound(h.s).status, 'prepared'); assert.equal(currentRound(h.s).runId, null);
  assert.deepEqual(seriesOf(h.s), { a: 0, b: 0 }); assert.equal(h.s.action, null);
  await h.frame(3); assert.equal(currentRound(h.s).status, 'playing');
});

test('startup evidence is volatile: loading, disconnect and pause cannot turn a first Playing or old Ranking into a run', async () => {
  for (const mode of ['load', 'disconnect', 'pause']) {
    const h = harness(); await h.frame(1); await h.frame(3); await h.frame(1);
    await h.cmd('referee-replay', { reason: '裁判确认' });
    const copy = mode === 'load' ? harness(structuredClone(h.s)) : h;
    if (mode === 'disconnect') await h.store.sourceStatus('disconnected');
    if (mode === 'pause') { await h.cmd('pause', { kind: 'technical' }); await h.frame(3); await h.cmd('resume'); }
    await copy.frame(3); await copy.frame(3); await copy.frame(4); await copy.frame(4);
    assert.equal(currentRound(copy.s).status, 'prepared', mode); assert.deepEqual(seriesOf(copy.s), { a: 0, b: 0 });
  }
});

test('an old Ranking after replay cannot complete or release the new prepared attempt', async () => {
  const h = harness(); await h.frame(1); await h.frame(3); await h.frame(1);
  await h.cmd('referee-replay', { reason: '裁判确认' }); const before = structuredClone(currentRound(h.s));
  await h.frame(4); await h.frame(4); assert.deepEqual(currentRound(h.s), before); assert.equal(h.s.action, null);
  await h.frame(1); await h.frame(3, [0, 0]); await h.frame(3); assert.equal(currentRound(h.s).status, 'playing');
});

test('a continuous long loading phase can recover, but a silent gap cannot reuse the earlier ready intent', async () => {
  for (const silent of [false, true]) {
    const h = harness(); await h.frame(1); await h.frame(3); await h.frame(1);
    await h.cmd('referee-replay', { reason: '裁判确认' });
    if (silent) h.advance(6000);
    for (let i = 0; i < 20; i++) await h.frame(3, [0, 0]);
    await h.frame(3);
    assert.equal(currentRound(h.s).status, silent ? 'prepared' : 'playing');
    await h.frame(4); await h.frame(4);
    assert.deepEqual(seriesOf(h.s), silent ? { a: 0, b: 0 } : { a: 1, b: 0 });
  }
});

test('a new ordinary Pick also preserves its observed ready-to-Playing edge across empty startup IDs', async () => {
  const h = harness(); await h.frame(1); await h.frame(3, [0, 0]); await h.frame(3);
  assert.equal(currentRound(h.s).status, 'playing');
  await h.frame(4); await h.frame(4); assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 });
});

test('series correction during replay preparation does not become a required recovery action or supply a winner', async () => {
  const h = harness(); await h.frame(1); await h.frame(3); await h.frame(1);
  await h.cmd('referee-replay', { reason: '裁判确认' });
  await h.frame(3, [0, 0]); await h.cmd('set-series', { a: 2, b: 1, reason: '核对已有系列分' }); await h.frame(3);
  assert.equal(currentRound(h.s).status, 'playing'); assert.equal(currentRound(h.s).winner, null);
  await h.frame(4); await h.frame(4); assert.deepEqual(seriesOf(h.s), { a: 3, b: 1 });
});

test('an explicitly confirmed same-map replay tolerates cleared map metadata while ready, then validates the actual map before starting', async () => {
  const h = harness(); await h.frame(1); await h.frame(3); await h.frame(1, [0, 0], 0);
  await h.cmd('referee-replay', { reason: '裁判确认原图重赛，房间资料加载中' });
  await h.frame(3, [0, 0], 0); assert.equal(currentRound(h.s).status, 'prepared');
  await h.frame(3); assert.equal(currentRound(h.s).status, 'playing');
  await h.frame(4); await h.frame(4); assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 });
});

test('a different ready map invalidates the replay start intent instead of assigning that start to the old selection', async () => {
  const h = harness(); await h.frame(1); await h.frame(3); await h.frame(1);
  await h.cmd('referee-replay', { reason: '裁判确认' });
  await h.frame(1, [0, 0], 2); await h.frame(3, [0, 0], 1); await h.frame(3);
  assert.equal(currentRound(h.s).status, 'prepared'); await h.frame(4); await h.frame(4);
  assert.deepEqual(seriesOf(h.s), { a: 0, b: 0 });
});
