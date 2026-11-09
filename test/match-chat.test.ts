import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTosuV2 } from '../src/tosu.js';
import { formatChatTime, presentMatchChat } from '../ui/matchChat.ts';
import type { RoomPlayer } from '../ui/session';

const players = (count: number): RoomPlayer[] => Array.from({ length: count }, (_, ipcId) => ({
  ipcId, side: ipcId < count / 2 ? 'left' : 'right', osuId: ipcId + 1, name: `Player ${ipcId}`
}));
const messages = (count: number) => Array.from({ length: count }, (_, index) => ({
  name: `Player ${index}`, team: 'left', message: `Message ${index}`, timestamp: '09:08:07'
}));

test('tosu normalization preserves zero-based IPC slots, including holes, and rejects invalid IDs', () => {
  const ids = [0, 5, 7, undefined, -1, 1.5, '2', Infinity];
  const raw = { state: {}, beatmap: {}, tourney: { clients: ids.map(ipcId => ({ ipcId, team: 'left', user: { id: 1, name: 'Player' } })) } };
  assert.deepEqual(normalizeTosuV2(raw).tourney!.players.map(player => player.ipcId), [0, 5, 7, null, null, null, null, null]);
});

test('six and eight broadcast slots use live client sides and gray users beyond the layout boundary', () => {
  for (const count of [6, 8]) {
    const roster = players(count);
    roster.push({ ipcId: count, side: 'right', osuId: 100, name: 'Outside' });
    const lines = [...messages(count), { name: 'Outside', team: 'right' }, { name: 'Referee', team: 'left' }];
    const before = JSON.stringify({ roster, lines });
    assert.deepEqual(presentMatchChat(lines, roster, count).map(line => line.team), [
      ...Array(count / 2).fill('left'), ...Array(count / 2).fill('right'), 'unknown', 'unknown'
    ]);
    assert.equal(JSON.stringify({ roster, lines }), before);
  }
});

test('layout changes and live swaps recolor retained messages without trusting their old team field', () => {
  const roster = players(8), lines = messages(8);
  assert.equal(presentMatchChat(lines, roster, 8)[7]!.team, 'right');
  assert.equal(presentMatchChat(lines, roster, 6)[7]!.team, 'unknown');
  [roster[0]!.name, roster[4]!.name] = [roster[4]!.name, roster[0]!.name];
  const changed = presentMatchChat(lines, roster, 8);
  assert.equal(changed[0]!.team, 'right');
  assert.equal(changed[4]!.team, 'left');
  roster[4]!.name = 'Replacement';
  assert.equal(presentMatchChat(lines, roster, 8)[0]!.team, 'unknown');
});

test('empty, missing or reordered clients never compact later slots into the broadcast range', () => {
  const roster = players(8).reverse().filter(player => player.ipcId !== 2);
  roster.find(player => player.ipcId === 1)!.osuId = 0;
  const teams = presentMatchChat(messages(8), roster, 6).map(line => line.team);
  assert.deepEqual(teams, ['left', 'unknown', 'unknown', 'left', 'right', 'right', 'unknown', 'unknown']);
  assert.ok(presentMatchChat(messages(8), [], 8).every(line => line.team === 'unknown'));
  const unknown = { ipcId: null, side: 'left', osuId: 100, name: 'Missing slot' } as const;
  assert.equal(presentMatchChat([{ name: unknown.name, team: 'left' }], [unknown], 8)[0]!.team, 'unknown');
});

test('BanchoBot variants and bot messages have priority even when a slot claims another team', () => {
  const roster = players(6); roster[0]!.name = 'BanchoBot';
  const lines = [{ name: 'BanchoBot', team: 'left' }, { name: 'Banchobot' }, { name: ' bAnChObOt ' },
    { name: 'System', team: 'bot' }, { name: 'BanchoBot Fan' }];
  assert.deepEqual(presentMatchChat(lines, roster, 6).map(line => line.team), ['bot', 'bot', 'bot', 'bot', 'unknown']);
});

test('ambiguous names stay neutral and nickname, message and source time are preserved', () => {
  const roster = players(6); roster[1]!.name = roster[0]!.name;
  const lines = [{ name: 'Player 0', message: '<script>alert(1)</script>' + '长消息'.repeat(200), timestamp: '12:34:56' }];
  const result = presentMatchChat(lines, roster, 6)[0]!;
  assert.equal(result.team, 'unknown');
  assert.equal(result.name, lines[0]!.name); assert.equal(result.message, lines[0]!.message);
  assert.equal(result.timestamp, '12:34:56'); assert.equal(result.time.text, '12:34:56');
});

test('chat clocks retain real seconds and mark unavailable precision without using the arrival time', () => {
  for (const [source, expected] of [['00:00:00', '00:00:00'], ['9:08:07', '09:08:07'], ['[23:59:59]', '23:59:59'],
    [' 12:34 ', '12:34:--'], ['[1:02]', '01:02:--']]) assert.equal(formatChatTime(source).text, expected);
  assert.match(formatChatTime('12:34').title, /秒数未知/);
  for (const source of [null, undefined, '', 'invalid', '[12:34:56', '12:34:56]', '24:00:00', '12:60:00', '12:34:60', 123, '2026-11-09T12:34:56']) {
    assert.equal(formatChatTime(source).text, '--:--:--');
  }
});

test('ISO source times display in the machine timezone with stable seconds', () => {
  for (const source of ['2026-11-09T12:34:56.123Z', '2026-11-09T20:34:56+08:00']) {
    const date = new Date(source);
    assert.equal(formatChatTime(source).text, [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'));
  }
  for (const source of ['2026-13-09T12:34:56Z', '2026-11-09T25:34:56Z']) assert.equal(formatChatTime(source).text, '--:--:--');
});
