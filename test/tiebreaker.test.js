import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as model from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';

const cmd = (s, type, payload = {}) => model.transition(s, { id: randomUUID(), version: s.version, type, payload });
const pool = [{ id: 'nm', label: 'NM1', mod: 'NM', beatmapId: 100 },
  { id: 'tb', label: 'TB1', mod: 'TB', beatmapId: 101 }, { id: 'tb2', label: 'TB2', mod: 'TB', beatmapId: 102 }];
function setup(stage = 'group') {
  return cmd(model.newSession(), 'setup', { title: 'TB 隔离合成测试', stage, mode: '3v3', source: '4x3',
    teams: { a: { name: 'L', roster: [] }, b: { name: 'R', roster: [] } }, pool });
}
const score = (s, a, b = a) => cmd(s, 'set-series', { a, b, reason: '核对实际系列比分' });
const prepare = (s, entryId = 'tb') => cmd(s, 'prepare-round', { entryId, tiebreaker: true });

for (const [stage, tie] of [['group', 5], ['final', 6]]) test(`${stage} TB requires the exact verified tie and does not invent history`, () => {
  let s = setup(stage);
  assert.throws(() => prepare(s), /核对系列比分/);
  s = score(s, tie, tie - 1); assert.equal(model.tiebreakerProgress(s).eligible, false);
  s = score(s, tie); assert.equal(model.tiebreakerProgress(s).canPrepare, true);
  assert.deepEqual(new SessionStore({ state: s }).snapshot().session.bp.tiebreaker, model.tiebreakerProgress(s));
  const before = structuredClone(s); s.ex.team = 'a';
  s = prepare(s);
  assert.equal(s.rounds.length, 1); assert.equal(model.currentRound(s).pickedBy, null);
  assert.equal(s.ex.team, null); assert.deepEqual(s.ex.remaining, before.ex.remaining);
  assert.deepEqual(s.bpHistory, before.bpHistory); assert.deepEqual(model.seriesOf(s), { a: tie, b: tie });
  const id = s.currentRoundId; s = prepare(s, 'tb2');
  assert.equal(s.currentRoundId, id); assert.equal(model.currentRound(s).entryId, 'tb2');
  s = cmd(s, 'undo'); assert.equal(model.currentRound(s).entryId, 'tb');
  s = score(s, tie - 1, tie); assert.throws(() => cmd(s, 'start'), /核对决胜比分/);
});

test('TB cannot be banned, marked as a team Pick, converted from an ordinary round or prepared through manual BP', () => {
  let s = cmd(setup(), 'bp');
  s = cmd(s, 'set-action', { action: { kind: 'pick', team: 'a' } });
  assert.throws(() => cmd(s, 'apply-bp', { entryId: 'tb' }), /TB 单独/);
  for (const status of ['banned', 'picked']) assert.throws(() => cmd(s, 'map-mark', { entryId: 'tb', status, team: 'a' }), /TB 不可/);
  s = cmd(s, 'prepare-round', { entryId: 'nm', pickedBy: 'a' });
  assert.throws(() => cmd(s, 'adjust-round', { entryId: 'tb' }), /TB 单独/);
  assert.throws(() => cmd(s, 'setting', { field: 'pool', value: pool.map(e => e.id === 'nm' ? { ...e, mod: 'TB' } : e) }), /转换普通图与 TB/);
  s = score(s, 5); assert.throws(() => prepare(s), /作废/);
  s = cmd(s, 'void-round', { reason: '误准备普通图' }); s = prepare(s);
  assert.throws(() => cmd(s, 'ex', { team: 'b', remaining: { a: 2, b: 2 } }), /TB/);
  assert.throws(() => cmd(s, 'adjust-round', { entryId: 'nm', pickedBy: 'a' }), /TB 单独/);
});

test('pending results, pause, missing TB and corrected scores control the preparation hint', () => {
  let s = cmd(setup(), 'prepare-round', { entryId: 'nm', pickedBy: 'a' });
  s = cmd(cmd(s, 'start'), 'ranking'); s.seriesAdjustment = { a: 5, b: 5 };
  assert.equal(model.tiebreakerProgress(s).canPrepare, false); assert.throws(() => prepare(s), /待处理/);
  s = score(s, 5); assert.equal(model.currentRound(s).winner, null);
  assert.equal(model.tiebreakerProgress(s).canPrepare, true);
  s = cmd(s, 'pause', { kind: 'technical' }); assert.equal(model.tiebreakerProgress(s).canPrepare, false);
  s = cmd(s, 'resume'); s = score(s, 4, 5); assert.equal(model.tiebreakerProgress(s).eligible, false);
  s = score(s, 5); s.pool = s.pool.filter(e => e.mod !== 'TB');
  assert.match(model.tiebreakerProgress(s).reason, /补齐本场 TB/);
});

test('TB result, correction, retraction and replay preserve score and ordinary BP queue semantics', () => {
  let s = score(setup(), 5);
  s = cmd(s, 'set-action', { action: { kind: 'pick', team: 'b' }, queue: [{ kind: 'pick', team: 'a' }] });
  const actions = [s.action, ...s.queue]; s = prepare(s); assert.deepEqual(s.queue, actions);
  s = cmd(cmd(s, 'start'), 'ranking'); assert.equal(s.action, null);
  s = cmd(s, 'record-result', { roundId: s.currentRoundId, winner: 'a' });
  assert.deepEqual(model.seriesOf(s), { a: 6, b: 5 });
  s = cmd(s, 'correct-result', { roundId: s.currentRoundId, winner: 'b', reason: '裁判核对' });
  assert.deepEqual(model.seriesOf(s), { a: 5, b: 6 });
  s = cmd(s, 'retract-result', { roundId: s.currentRoundId, reason: '重新核对' });
  assert.deepEqual(model.seriesOf(s), { a: 5, b: 5 });
  const old = s.currentRoundId; s = cmd(s, 'referee-replay', { reason: '裁判确认重赛' });
  assert.equal(model.currentRound(s).replayOf, old); assert.equal(model.currentRound(s).pickedBy, null);
  assert.equal(model.currentRound(s).exTeam, null); assert.deepEqual(s.queue, actions);
  assert.equal(model.currentRound(cmd(s, 'start')).status, 'playing');
});

test('fresh tosu TB run awards once; old Ranking cannot undo a manual retraction', async () => {
  const store = new SessionStore({ state: prepare(score(setup(), 5)) }); let now = 0;
  const frame = ipcState => store.frame({ beatmap: { id: 101 }, tourney: { ipcState, teams: { left: 'L', right: 'R' },
    totalScore: { left: 900, right: 800 }, players: [{ side: 'left', osuId: 1, score: 900 }, { side: 'right', osuId: 2, score: 800 }] } }, now += 500);
  await frame(1); await frame(3); await frame(4); await frame(4); await frame(4);
  assert.deepEqual(model.seriesOf(store.state), { a: 6, b: 5 });
  await store.command({ id: randomUUID(), version: store.state.version, type: 'retract-result', payload: { roundId: store.state.currentRoundId, reason: '裁判待核对' } });
  await frame(4); await frame(4); assert.deepEqual(model.seriesOf(store.state), { a: 5, b: 5 });
});

if (model.newCustomSession) for (const bo of [5, 9, 11, 13]) test(`custom BO${bo} uses its own target`, () => {
  let s = model.newCustomSession();
  s = cmd(s, 'setting', { field: 'pool', value: pool });
  assert.equal(model.tiebreakerProgress(s).eligible, false); assert.throws(() => prepare(s), /核对系列比分/);
  s = cmd(s, 'setting', { field: 'bestOf', value: bo });
  const tie = (bo - 1) / 2; s = score(s, tie);
  assert.equal(model.tiebreakerProgress(s).canPrepare, true); s = prepare(s);
  assert.equal(model.currentRound(s).pickedBy, null); assert.equal(model.targetOf(s), tie + 1);
});
