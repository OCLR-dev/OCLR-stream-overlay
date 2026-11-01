import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../server/session/store.js';
import { currentRound, newSession, seriesOf, transition } from '../server/session/model.js';

async function harness() {
  let state = newSession();
  const command = (type, payload = {}) => { state = transition(state, { id: randomUUID(), version: state.version, type, payload }); };
  command('setup', { title: '观战重载 · 合成测试', stage: 'group', mode: '3v3', source: '4x3', teams: { a: { name: 'L', roster: [] }, b: { name: 'R', roster: [] } }, pool: [1, 2].map(i => ({ id: `m${i}`, label: `NM${i}`, mod: 'NM', beatmapId: i })) });
  command('bp'); command('set-action', { action: { kind: 'pick', team: 'a' }, queue: [{ kind: 'pick', team: 'b' }] }); command('apply-bp', { entryId: 'm1' });
  const store = new SessionStore({ state }); let now = 1000;
  const h = { store, get s() { return store.state; },
    cmd(type, payload = {}) { return store.command({ id: randomUUID(), version: store.state.version, type, payload }); },
    frame(ipc = 3, options = {}, ms = 500) {
      const { id = 1, left = 900, right = 800, players = [{ side: 'left', osuId: 1, score: left }, { side: 'right', osuId: 2, score: right }], teams = { left: 'L', right: 'R' } } = options;
      return store.frame({ beatmap: { id }, tourney: { ipcState: ipc, teams, totalScore: { left, right }, players } }, now += ms);
    },
  };
  await h.frame(1); await h.frame(3); return h;
}
const loading = { id: 0, left: 0, right: 0, players: [] };

test('Panic reload automatically resumes the original run, then awards once and follows the next Pick', async () => {
  const h = await harness(); const original = structuredClone(currentRound(h.s));
  await h.frame(0, loading); assert.ok(h.s.incident);
  await h.frame(3, loading); await h.frame(3, { left: 950, right: 850 }); assert.ok(h.s.incident);
  await h.frame(3, { left: 1000, right: 900 }); assert.equal(h.s.incident, null);
  assert.equal(currentRound(h.s).id, original.id); assert.equal(currentRound(h.s).runId, original.runId);
  assert.deepEqual(seriesOf(h.s), { a: 0, b: 0 }); assert.equal(h.s.rounds.length, 1);
  await h.frame(4, { left: 1000, right: 900 }); await h.frame(4, { left: 1000, right: 900 });
  assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 }); await h.frame(4, { left: 1000, right: 900 });
  assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 });
  await h.frame(1); await h.frame(1, { id: 2 }); await h.frame(1, { id: 2 });
  assert.equal(currentRound(h.s).entryId, 'm2'); assert.equal(currentRound(h.s).pickedBy, 'b');
});

test('partial windows can reload gradually, but no recovery until every original player returns with consistent scores', async () => {
  const h = await harness(); await h.frame(3, { players: [{ side: 'left', osuId: 1, score: 900 }] });
  for (let i = 0; i < 2; i++) await h.frame(3, { players: [{ side: 'left', osuId: 1, score: 900 }, { side: 'right', osuId: 2, score: 0 }] });
  assert.ok(h.s.incident); await h.frame(3); await h.frame(3); assert.equal(h.s.incident, null);
});

for (const kind of ['ready', 'ranking', 'map', 'room', 'player', 'reset-score', 'gap', 'timeout', 'manual', 'pause', 'disconnect', 'replay']) {
  test(`spectator recovery does not override ${kind}`, async () => {
    const h = await harness(); await h.frame(0, loading);
    if (kind === 'ready') await h.frame(1);
    if (kind === 'ranking') await h.frame(4);
    if (kind === 'map') await h.frame(3, { id: 2 });
    if (kind === 'room') await h.frame(3, { teams: { left: 'Other', right: 'R' } });
    if (kind === 'gap') await h.frame(3, {}, 5001);
    if (kind === 'timeout') for (let i = 0; i < 31; i++) await h.frame(0, loading, 1000);
    if (kind === 'manual') await h.cmd('incident', { kind: 'player-disconnect', reason: '裁判等待实际选手掉线处理' });
    if (kind === 'pause') await h.cmd('pause', { kind: 'technical' });
    if (kind === 'disconnect') await h.store.sourceStatus('disconnected');
    if (kind === 'replay') await h.cmd('referee-replay', { reason: '裁判已确认重赛' });
    const options = kind === 'player' ? { players: [{ side: 'left', osuId: 10, score: 900 }, { side: 'right', osuId: 2, score: 800 }] } : kind === 'reset-score' ? { left: 0, right: 0 } : {};
    await h.frame(3, options); await h.frame(3, options);
    if (kind === 'pause') assert.equal(h.s.paused, true);
    else if (kind === 'replay') assert.equal(currentRound(h.s).replayOf !== undefined, true);
    else assert.ok(h.s.incident);
    assert.deepEqual(seriesOf(h.s), { a: 0, b: 0 });
  });
}

test('restart cannot inherit reload evidence from persisted state or replay an old Ranking', async () => {
  const h = await harness(); await h.frame(0, loading);
  const restored = new SessionStore({ state: structuredClone(h.s) });
  const fresh = { beatmap: { id: 1 }, tourney: { ipcState: 3, teams: { left: 'L', right: 'R' }, totalScore: { left: 900, right: 800 }, players: [{ side: 'left', osuId: 1, score: 900 }, { side: 'right', osuId: 2, score: 800 }] } };
  await restored.frame(fresh, 3000); await restored.frame(fresh, 3500);
  assert.ok(restored.state.incident); assert.deepEqual(seriesOf(restored.state), { a: 0, b: 0 });
});
