import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocation, serializeState, changeField, changeBan, derive } from '../ui/model.ts';

test('old links retain zero, unknown, hash priority and invalid S11 safeguards', () => {
  const state = parseLocation('?scene=playing&mode=3v3&starA=4', '#scene=map-result&starA=0&starB=unknown&exA=0&banA1=HD&banA2=HD');
  assert.equal(state.scene, 'playing');
  assert.equal(state.mode, '3v3');
  assert.equal(state.seriesA, 0);
  assert.equal(state.seriesB, null);
  assert.equal(state.exA, 0);
  assert.deepEqual(state.banSlots.a, ['HD', 'unknown']);
  assert.deepEqual(parseLocation('', serializeState(state)), state);
  assert.equal(parseLocation('', '#playing').scene, 'playing');
  assert.equal(parseLocation('', '#lead=left').lead, 'left-small');
  assert.equal(parseLocation('', '#mode=2v2&starA=NaN').mode, '4v4');
});

test('EX reduces both teams, excludes Captain/T1, preserves counters and result totals', () => {
  for (const mode of ['3v3', '4v4']) {
    for (const exTeam of ['a', 'b']) {
      const state = parseLocation('', `mode=${mode}&exTeam=${exTeam}&exA=1&exB=0&starA=3`);
      const view = derive(state);
      assert.equal(view.count, mode === '3v3' ? 2 : 3);
      assert.equal(view.players.length, view.count * 2);
      assert.ok(view.players.every(p => !['Captain', 'T1'].includes(p.role)));
      assert.equal(view.resultA, mode === '3v3' ? '670,000' : '970,000');
      assert.equal(view.resultB, mode === '3v3' ? '640,000' : '930,000');
      const result = changeField(state, 'scene', 'map-result');
      assert.equal(result.exA, 1);
      assert.equal(result.exB, 0);
      assert.equal(result.seriesA, 3);
      const tb = changeField(result, 'mapType', 'tb');
      assert.equal(tb.exTeam, 'none');
      assert.equal(derive(tb).count, mode === '3v3' ? 3 : 4);
      assert.equal(changeField(tb, 'exTeam', 'a').exTeam, 'none');
      assert.equal(changeField(tb, 'mapType', 'normal').exTeam, 'none');
    }
  }
});

test('Ban rejection preserves state, permits repeat NM/FM, and stage changes clear invalid stars', () => {
  const state = parseLocation('', 'stage=final&starA=7&starB=0&banA1=HD');
  const duplicate = changeBan(state, 'a', 1, 'HD');
  assert.match(duplicate.feedback, /已阻止 HD/);
  assert.deepEqual(duplicate.state.banSlots.a, ['HD', 'unknown']);
  assert.match(changeBan(state, 'a', 1, 'TB').feedback, /TB 不可 Ban/);
  assert.equal(changeBan(state, 'a', 1, 'empty').state.banSlots.a[1], 'empty');
  for (const mod of ['NM', 'FM']) {
    const first = changeBan(state, 'b', 0, mod).state;
    assert.deepEqual(changeBan(first, 'b', 1, mod).state.banSlots.b, [mod, mod]);
  }
  const group = changeField(state, 'stage', 'group');
  assert.equal(group.seriesA, null);
  assert.equal(group.seriesB, 0);
  assert.equal(derive(group).meta.target, 6);
});

test('manual broadcast ownership and explicit clear survive later score changes without mutating records', async () => {
  const { poolDisplay } = await import('../ui/poolDisplay.ts');
  const s = { bans: { a: ['hd1', null], b: [null, null] }, rounds: [{ entryId: 'nm1', pickedBy: 'a', status: 'recorded', winner: 'a' }],
    poolMarks: [{ entryId: 'nm1', status: 'banned', team: 'b' }, { entryId: 'hd1', status: 'open', team: null }] };
  const before = structuredClone(s);
  assert.deepEqual(poolDisplay(s, 'nm1'), { status: 'banned', team: 'b' });
  assert.deepEqual(poolDisplay(s, 'hd1'), { status: 'open', team: null });
  assert.deepEqual(s, before);
  s.rounds[0].winner = 'b';
  assert.deepEqual(poolDisplay(s, 'nm1'), { status: 'banned', team: 'b' });
  assert.deepEqual(poolDisplay({ ...s, poolMarks: undefined }, 'nm1'), { status: 'used', team: 'a' });
});

test('old backend command rejection explains the service update rather than suggesting match corrections', async () => {
  const { commandErrorMessage } = await import('../ui/session.ts');
  assert.match(commandErrorMessage('未知会话命令'), /本机服务尚未更新/);
  assert.doesNotMatch(commandErrorMessage('未知会话命令'), /手动调整/);
  assert.equal(commandErrorMessage('该图已经 Ban'), '该图已经 Ban');
  assert.equal(commandErrorMessage(undefined), '操作未应用');
});
