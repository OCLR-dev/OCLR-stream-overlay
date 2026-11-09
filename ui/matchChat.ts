import type { RoomChatLine, RoomPlayer } from './session';

export function formatChatTime(timestamp: unknown) {
  const unknown = { text: '--:--:--', title: '消息时间不可用' };
  if (typeof timestamp !== 'string') return unknown;
  const value = timestamp.trim();
  // osu!tourney supplies the game's displayed clock, not an epoch timestamp.
  const clockValue = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  const clock = clockValue.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clock) {
    const [, hours, minutes, seconds] = clock;
    if (Number(hours) > 23 || Number(minutes) > 59 || (seconds !== undefined && Number(seconds) > 59)) return unknown;
    return { text: `${hours!.padStart(2, '0')}:${minutes}:${seconds ?? '--'}`,
      title: seconds === undefined ? '来源仅提供时分，秒数未知' : '消息时间' };
  }
  // The simulator and other v2 sources may supply an ISO timestamp. Require an
  // explicit zone so browsers cannot interpret an ambiguous date differently.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return unknown;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return unknown;
  return { text: [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'),
    title: '消息时间（本机时区）' };
}

export function presentMatchChat(lines: RoomChatLine[], players: RoomPlayer[], slotCount: number) {
  // IPC IDs identify actual slots. Filtering by ID preserves empty slots and
  // never promotes later clients into the first six/eight broadcast positions.
  const visible = players.filter(player => Number.isSafeInteger(player.ipcId) && player.ipcId! >= 0 && player.ipcId! < slotCount &&
    Number.isSafeInteger(player.osuId) && player.osuId! > 0 && player.name?.trim() && ['left', 'right'].includes(player.side || ''));
  return lines.map(line => {
    const name = line.name?.trim().toLowerCase();
    const matches = name ? visible.filter(player => player.name!.trim().toLowerCase() === name) : [];
    const bot = line.team?.toLowerCase() === 'bot' || name === 'banchobot';
    const team = bot ? 'bot' : matches.length === 1 ? matches[0]!.side! : 'unknown';
    return { ...line, team, time: formatChatTime(line.timestamp) };
  });
}
