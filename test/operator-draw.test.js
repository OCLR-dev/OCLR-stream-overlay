import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newSession, transition, currentRound, seriesOf } from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';

const send = (s, type, payload = {}) => transition(s, { id: randomUUID(), version: s.version, type, payload });
function prepared(tiedMapPolicy) {
  let s = send(newSession(), 'import-streaming', {
    title: '平局操作隔离回归', stage: 'exhibition', mode: '1v1', source: '4x3',
    teams: { a: { name: '测试红队', roster: [] }, b: { name: '测试蓝队', roster: [] } },
    pool: [{ id: 'nm2', beatmapId: 102, label: 'NM2', mod: 'NM' }],
    exhibition: { roundName: '隔离测试', series: { type: 'fixed_maps', count: 3, allowDraw: true }, tiedMapPolicy, autoResults: true },
  });
  s = send(s, 'auto', { bp: false, scenes: true, results: true, profile: 'stable-tourney', left: '测试红队', right: '测试蓝队' });
  return send(send(s, 'bp'), 'prepare-round', { entryId: 'nm2', pickedBy: 'a' });
}
const command = (store, type, payload = {}) => store.command({ id: randomUUID(), version: store.state.version, type, payload });

test('a tied attempt stays pending until referee replay, then its same-map replay awards exactly once', async t => {
  const store = new SessionStore({ state: prepared('require_replay') }); t.after(() => store.close());
  let now = Date.now();
  const frame = async (ipc, a = 500, b = 500) => {
    now += 1000;
    await store.frame({ beatmap: { id: 102 }, tourney: { ipcState: ipc, teams: { left: '测试红队', right: '测试蓝队' },
      totalScore: { left: a, right: b }, players: [{ side: 'left', osuId: 1, score: a }, { side: 'right', osuId: 2, score: b }] } }, now);
  };
  for (const ipc of [1, 3, 3, 4, 4, 4]) await frame(ipc);
  const tiedId = currentRound(store.state).id;
  assert.equal(currentRound(store.state).status, 'ranking');
  assert.deepEqual(currentRound(store.state).finalScore, { a: 500, b: 500 });
  for (const ipc of [1, 3, 3, 4, 4, 4]) await frame(ipc, 800, 900);
  assert.equal(currentRound(store.state).id, tiedId);
  assert.equal(currentRound(store.state).status, 'ranking');
  assert.deepEqual(seriesOf(store.state), { a: 0, b: 0 });
  await command(store, 'referee-replay', { reason: '裁判确认平局重赛' });
  assert.equal(currentRound(store.state).replayOf, tiedId);
  for (const ipc of [1, 1, 3, 3, 4, 4, 4, 4]) await frame(ipc, 800, 900);
  assert.equal(currentRound(store.state).status, 'recorded');
  assert.equal(currentRound(store.state).winner, 'b');
  assert.deepEqual(seriesOf(store.state), { a: 0, b: 1 });
  assert.equal(store.state.rounds.find(r => r.id === tiedId).status, 'void');
});

test('a counted draw can be corrected to either team, restored to a draw and retracted', () => {
  let s = send(send(prepared('count_as_draw'), 'start'), 'ranking');
  const roundId = currentRound(s).id;
  s = send(s, 'record-result', { roundId, winner: null, keepDisplay: true });
  for (const [winner, expected] of [['b', { a: 0, b: 1 }], [null, { a: 0, b: 0 }], ['a', { a: 1, b: 0 }], [null, { a: 0, b: 0 }]]) {
    s = send(s, 'correct-result', { roundId, winner, reason: '核对实际赛果' });
    assert.deepEqual(seriesOf(s), expected);
    assert.equal(s.rounds.filter(r => r.status === 'recorded').length, 1);
  }
  s = send(s, 'retract-result', { roundId, reason: '等待裁判核对' });
  assert.equal(currentRound(s).status, 'ranking');
  assert.deepEqual(seriesOf(s), { a: 0, b: 0 });
});
