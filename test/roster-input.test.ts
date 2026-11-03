import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRosterInput, parseRosterInput } from '../ui/rosterInput.ts';

test('roster lines accept a username and UID together, or either one alone', () => {
  assert.deepEqual(parseRosterInput('Alice,12345\n67890\nBob\n,24680\nCarol，13579'), [
    { name: 'Alice', osuId: 12345 },
    { name: '67890', osuId: 67890 },
    { name: 'Bob', osuId: null },
    { name: '24680', osuId: 24680 },
    { name: 'Carol', osuId: 13579 },
  ]);
});

test('missing username falls back to UID; missing both stays visibly unknown', () => {
  assert.deepEqual(parseRosterInput(',24680\n,'), [
    { name: '24680', osuId: 24680 },
    { name: '未知', osuId: null },
  ]);
});

test('invalid UID and extra separators are rejected with the line number', () => {
  assert.throws(() => parseRosterInput('Alice,abc'), /第 1 行 UID 无效/);
  assert.throws(() => parseRosterInput('Alice,0'), /第 1 行 UID 无效/);
  assert.throws(() => parseRosterInput('Alice,123,extra'), /第 1 行格式应为/);
  assert.throws(() => parseRosterInput(Array.from({ length: 21 }, (_, i) => `P${i}`).join('\n')), /最多 20 人/);
});

test('formatting keeps both values without repeating a UID-only name', () => {
  assert.equal(formatRosterInput([
    { name: 'Alice', osuId: 12345 },
    { name: '67890', osuId: 67890 },
    { name: 'Bob', osuId: null },
    { name: null, osuId: 24680 },
    { name: null, osuId: null },
  ]), 'Alice,12345\n67890\nBob\n24680\n未知');
});
