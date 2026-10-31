import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../server/session/store.js';
import { newSession, currentRound, seriesOf } from '../server/session/model.js';
function harness() {
  const store = new SessionStore({ state: newSession() }); let now = 1000;
  const cmd = (type, payload) => store.command({ id: crypto.randomUUID(), version: store.state.version, type, payload });
  const frame = (ipc = 1, left = '房间左队', right = '房间右队') => store.frame({ beatmap: { id: 101 }, tourney: { ipcState: ipc, teams: { left, right }, totalScore: { left: 900, right: 800 }, players: [{ side: 'left', osuId: 1, score: 900 }, { side: 'right', osuId: 2, score: 800 }] } }, now += 500);
  return { store, cmd, frame };
}
test('tosu room names update match settings and output names without replacing teams, rosters or records', async () => {
  const { store, frame } = harness();
  store.state.match.teams.a = { id: 'published-a', name: '模板左队', roster: [{ name: '选手甲', osuId: 10 }] };
  store.state.match.teams.b = { id: 'published-b', name: '模板右队', roster: [{ name: '选手乙', osuId: 20 }] };
  const before = structuredClone(store.state); await frame();
  for (const [side, name] of [['a', '房间左队'], ['b', '房间右队']]) {
    assert.equal(store.state.match.teams[side].name, name); assert.equal(store.state.match.teams[side].id, before.match.teams[side].id);
    assert.deepEqual(store.state.match.teams[side].roster, before.match.teams[side].roster);
  }
  assert.deepEqual(store.state.rounds, before.rounds); assert.deepEqual(store.state.bans, before.bans); assert.deepEqual(store.state.bpHistory, before.bpHistory);
  assert.deepEqual(seriesOf(store.state), seriesOf(before)); assert.equal(store.state.undo.length, before.undo.length);
  const version = store.state.version; await frame(); assert.equal(store.state.version, version);
});
test('restoring names when the existing room binding already matches preserves Playing-to-Ranking continuity', async () => {
  const { store, cmd, frame } = harness();
  await cmd('setting', { field: 'pool', value: [{ id: 'nm', label: 'NM1', mod: 'NM', beatmapId: 101 }] });
  await frame(); await cmd('prepare-round', { entryId: 'nm', pickedBy: 'a' });
  await frame(3); const run = currentRound(store.state).runId;
  store.state.match.teams.a.name = '旧模板'; await frame(4); await frame(4);
  assert.equal(store.state.match.teams.a.name, '房间左队'); assert.equal(currentRound(store.state).runId, run);
  assert.equal(currentRound(store.state).resultSource, 'tosu'); assert.deepEqual(seriesOf(store.state), { a: 1, b: 0 });
});
test('missing names do not erase match settings and a genuine room change still requires incident recovery', async () => {
  const { store, cmd, frame } = harness();
  await cmd('setting', { field: 'pool', value: [{ id: 'nm', label: 'NM1', mod: 'NM', beatmapId: 101 }] });
  await frame(); await frame(1, '', ''); assert.equal(store.state.match.teams.a.name, '房间左队');
  await frame(); await cmd('prepare-round', { entryId: 'nm', pickedBy: 'a' }); await frame(3);
  await frame(3, '新房间左队', '新房间右队'); assert.ok(store.state.incident);
  assert.equal(store.state.match.teams.a.name, '新房间左队'); assert.equal(store.state.match.teams.b.name, '新房间右队');
});
