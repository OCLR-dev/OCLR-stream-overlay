import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tosuRoomTeams } from '../../src/tosu.js';
import { currentRound, entryOf } from '../session/model.js';
import { ObsError } from './socket.js';

const readError = '读不到本场录像打点，请检查本机存储。';
const writeError = '录像打点未保存，请检查本机存储。';
const timecodeError = '读不到 OBS 录像时间，请核对录制状态。';

function roomFrame(tosu) {
  const data = tosu?.data;
  const teams = tosuRoomTeams(data);
  if (tosu?.status !== 'live' || !teams || !Number.isSafeInteger(data.beatmap?.id) || data.beatmap.id <= 0) return null;
  return { key: JSON.stringify([teams.left, teams.right, data.beatmap.id]), mapId: data.beatmap.id,
    title: data.beatmap.title || String(data.beatmap.id), ipc: data.tourney.ipcState, at: Date.parse(tosu.updatedAt) };
}

function timecode(duration) {
  const seconds = Math.floor(duration / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(part => String(part).padStart(2, '0')).join(':');
}

export class RecordingTimeline {
  constructor(directory, timestamp) {
    this.directory = directory;
    this.timestamp = timestamp;
    this.tail = Promise.resolve();
  }

  queue(fn) {
    const task = this.tail.then(fn);
    this.tail = task.catch(() => {});
    return task;
  }

  observe(session, tosu) {
    const room = roomFrame(tosu);
    const round = currentRound(session);
    const entry = entryOf(session, round?.entryId);
    const roomEntries = room ? session.pool.filter(map => map.beatmapId === room.mapId) : [];
    const roomLabel = roomEntries.length === 1 ? roomEntries[0].label || room.title : room?.title;

    if (session.id !== this.match?.id) {
      const match = { id: session.id, version: session.version, groups: [], attempts: new Set(),
        results: new Set(), room: null, error: '', loading: !!this.directory };
      this.match = match;
      if (this.directory) {
        match.file = join(this.directory, encodeURIComponent(session.id) + '.json');
        void this.queue(() => this.load(match));
      }
    }
    const match = this.match;
    const previous = match.room;
    const continuous = previous && room && previous.key === room.key && room.at >= previous.at && room.at - previous.at <= 5000;
    // Loading can occur between Ready and Playing. Carry the observed Ready through it.
    match.room = room && { ...room, ready: [1, 2].includes(room.ipc) || (room.ipc === 0 && continuous && previous.ready),
      unassigned: room.ipc === 3 && continuous && previous.unassigned };
    match.mapLabel = room?.ipc === 3 && room.mapId !== entry?.beatmapId ? roomLabel
      : round?.status !== 'void' && entry ? entry.label || entry.title : roomLabel;

    const attempt = ['prepared', 'playing'].includes(round?.status) && room && room.mapId === entry?.beatmapId ? round : null;
    if (match.room?.unassigned && attempt?.status === 'playing' && !attempt.replayOf) {
      match.attempts.add(attempt.id);
      match.room.unassigned = false;
    }
    if (room?.ipc === 3 && continuous && previous.ready) {
      match.room.unassigned = !attempt;
      if (!attempt || !match.attempts.has(attempt.id)) {
        if (attempt) match.attempts.add(attempt.id);
        const id = attempt?.runId ? `run:${attempt.runId}` : attempt ? `attempt:${attempt.id}` : `room:${crypto.randomUUID()}`;
        const map = attempt ? entry.label || entry.title || roomLabel : roomLabel;
        this.auto(match, id, `${map} ${attempt?.replayOf ? '重赛开打' : '开打'}`, attempt?.id);
      }
    }

    if (session.version !== match.version) {
      match.version = session.version;
      const event = session.history.at(-1);
      if (event?.version === session.version && event.changes?.some(change => change.type === 'WinnerConfirmed')) {
        const { a, b } = session.series;
        const key = `winner:${session.winner}:${a}:${b}`;
        if (match.results.has(key)) return;
        match.results.add(key);
        const result = session.winner ? `Winner · ${session.match.teams[session.winner].name}` : '全场平局';
        this.auto(match, key, `${result} ${a}–${b}`);
      }
    }
  }

  async load(match) {
    try {
      const data = JSON.parse(await readFile(match.file, 'utf8'));
      if (data.matchId !== match.id || !Array.isArray(data.groups) || data.groups.some(group =>
        typeof group.id !== 'string' || !Array.isArray(group.markers) || group.markers.some(marker =>
          typeof marker.id !== 'string' || typeof marker.label !== 'string' ||
          !Number.isSafeInteger(marker.duration) || marker.duration < 0))) throw new Error(readError);
      match.groups = data.groups;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        match.loadFailed = true;
        match.error = readError;
      }
    } finally { match.loading = false; }
  }

  auto(match, id, label, attemptId) { void this.mark(match, id, label, attemptId).catch(() => {}); }

  manual(matchId) {
    const match = this.match;
    if (!match || match.id !== matchId) throw new ObsError('比赛已切换，请核对本场后再打点。');
    const label = match.mapLabel ? `精彩时刻 · ${match.mapLabel}` : '精彩时刻';
    return this.mark(match, `manual:${crypto.randomUUID()}`, label);
  }

  mark(match, id, label, attemptId) {
    // Request at the event, before waiting for another marker to finish writing.
    const stamp = this.timestamp().catch(() => new ObsError(timecodeError));
    return this.queue(async () => {
      const time = await stamp;
      if (!time) return false;
      if (time instanceof ObsError) {
        match.error = time.message;
        throw time;
      }
      if (match.loadFailed) throw new ObsError(readError);
      if (match.groups.some(group => group.markers.some(marker => marker.id === id || (attemptId && marker.attemptId === attemptId)))) return false;
      const groups = structuredClone(match.groups);
      let group = groups.find(item => item.id === time.group.id);
      if (!group) {
        group = { id: time.group.id, rejoined: time.group.reconnected || (time.group.attached && groups.length > 0), markers: [] };
        groups.push(group);
      }
      group.markers.push({ id, duration: time.duration, label, ...(attemptId && { attemptId }) });
      try {
        if (match.file) {
          await mkdir(dirname(match.file), { recursive: true, mode: 0o700 });
          await writeFile(`${match.file}.tmp`, JSON.stringify({ matchId: match.id, groups }), { mode: 0o600 });
          await rename(`${match.file}.tmp`, match.file);
        }
      } catch {
        match.error = writeError;
        throw new ObsError(writeError);
      }
      match.groups = groups;
      match.error = '';
      return true;
    });
  }

  status() {
    return this.match?.error ? { matchId: this.match.id, message: this.match.error } : null;
  }

  snapshot() {
    const match = this.match;
    return { matchId: match?.id ?? null, loading: !!match?.loading, error: match?.error ?? '',
      groups: match?.groups.map((group, index) => ({
        title: `录像 ${index + 1}${group.rejoined ? ' · 重新接入' : ''}`,
        markers: [...group.markers].sort((a, b) => a.duration - b.duration)
          .map(marker => ({ id: marker.id, time: timecode(marker.duration), label: marker.label })),
      })) ?? [] };
  }
}
