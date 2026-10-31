import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sessionFromTemplate } from '../server/custom-template.js';
import { targetOf, bpProgress } from '../server/session/model.js';
import { testModForCategory } from '../server/beatmap-calculation.js';
const template = JSON.parse(await readFile(new URL('../configs/mp5-xronicle-swiss-2.json', import.meta.url), 'utf8'));

test('provided MP5 configuration preserves all 17 maps, two exact broadcast names and BO9 without room or BP guesses', () => {
  const s = sessionFromTemplate(template);
  assert.equal(s.match.title, 'MP5 Xronicle'); assert.equal(s.match.stageName, '瑞士轮');
  assert.equal(s.match.teams.a.name, '好麻烦啊......'); assert.equal(s.match.teams.b.name, '我发现队友都玩osu');
  assert.equal(targetOf(s), 5); assert.equal(s.pool.length, 17);
  assert.deepEqual(Object.fromEntries(['NM','HD','HR','DT','FM','CA','TB'].map(mod => [mod,s.pool.filter(e => e.mod === mod).length])), {NM:5,HD:2,HR:2,DT:3,FM:2,CA:2,TB:1});
  assert.deepEqual(s.pool.map(e => e.beatmapId), [804164,209276,269773,2044547,2635981,3279104,4323255,719594,4556723,1624401,451406,4682397,741853,81958,895331,533622,2452465]);
  assert.equal(s.auto.wsUrl, ''); assert.equal(s.auto.left, ''); assert.equal(s.auto.right, '');
  assert.equal(s.action, null); assert.match(bpProgress(s).waiting, /选择先 Ban 方/);
  assert.equal(s.rounds.length, 0); assert.equal(s.version, 0); assert.deepEqual(s.undo, []);
  assert.equal(testModForCategory('CA'), null);
});

test('template validation rejects malformed rules, pool IDs and BO instead of silently coercing input', () => {
  for (const patch of [{bestOf:8}, {format:'unknown'}, {bpRule:'pick winner'}, {pool:[{id:'x',label:'CA1',mod:'CA',beatmapId:0}]}]) {
    assert.throws(() => sessionFromTemplate({...template,...patch}));
  }
});
