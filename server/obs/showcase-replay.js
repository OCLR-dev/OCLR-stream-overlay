const mapKey = (id, checksum) => Number.isSafeInteger(id) && id > 0 ? String(id) :
  typeof checksum === 'string' && /^[a-f0-9]{32}$/i.test(checksum) ? checksum.toLowerCase() : null;

export function showcaseTokensUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  url.pathname = '/tokens';
  url.search = '';
  url.hash = '';
  return url.href;
}

// The native v2 state can report Play for both hands-on play and a replay.
// StreamCompanion's /tokens explicitly distinguishes the two.
export function normalizeShowcaseTokens(raw) {
  if (!raw || raw.error || !Number.isInteger(raw.status) || raw.osuIsRunning !== 1) throw new Error('INVALID_REPLAY_STATE');
  return { status: raw.status === 32 && raw.rawStatus !== 7 ? 0 : raw.status, map: mapKey(raw.mapid, raw.md5), time: Number.isFinite(raw.time) ? raw.time : null };
}

export function ordinaryClient(frame, map) {
  const room = frame?.tourney;
  return !!frame && map === mapKey(frame.beatmap?.id, frame.beatmap?.checksum) &&
    !Object.values(room?.teams || {}).some(name => typeof name === 'string' && name.trim()) &&
    !room?.players?.some(player => player.osuId > 0 || player.name?.trim());
}

export class ShowcaseReplay {
  constructor(onChange, resultsMs = 3500) {
    this.onChange = onChange;
    this.resultsMs = resultsMs;
    this.phase = 'covered';
    this.covered = true;
    this.instant = true;
  }

  change(phase) {
    if (phase === this.phase) return;
    this.phase = phase;
    this.covered = phase === 'covered';
    this.onChange();
  }

  reset(instant = true) {
    clearTimeout(this.timer);
    this.candidate = this.run = this.blocked = this.resultIdentity = null;
    if (this.phase !== 'covered') this.instant = instant;
    this.change('covered');
  }

  arm(map, frame, onWrong) {
    this.manual(true, frame);
    this.target = map;
    this.onWrong = onWrong;
  }

  hold() {
    this.target = '';
    this.onWrong = null;
    this.reset();
  }

  manual(covered, frame) {
    this.target = this.onWrong = null;
    this.reset();
    if (covered && frame?.status === 8 && frame.map && frame.time !== null) {
      this.blocked = { map: frame.map, time: frame.time };
    }
    if (!covered) this.change('manual');
  }

  observeResult(identity) {
    if (this.phase !== 'results' || !identity) return;
    if (this.resultIdentity && this.resultIdentity !== identity) this.reset();
    else this.resultIdentity = identity;
  }

  observe(frame, confirmedCover, v2State) {
    if (this.phase === 'manual' || (this.target === '' && this.phase === 'covered')) return;
    const { map, status, time } = frame;
    if (status === 32 && map) {
      this.blocked = this.candidate = null;
      if (this.phase === 'results' && this.run?.map === map) return;
      if (this.phase === 'playing' && confirmedCover === false && this.run?.map === map) {
        this.change('results');
        this.timer = setTimeout(() => this.reset(false), this.resultsMs);
        this.timer.unref?.();
      } else this.reset();
      return;
    }
    if (status !== 8 || !map || time === null) { this.reset(); return; }

    if (this.phase === 'playing' && this.run?.map === map && time >= this.run.time - 1) {
      this.run.time = Math.max(this.run.time, time);
      return;
    }
    if (this.phase !== 'covered') this.reset();
    // The operator may cover an ongoing replay to prepare the next file.
    if (this.blocked?.map === map && time >= this.blocked.time - 1) {
      this.blocked.time = Math.max(this.blocked.time, time);
      return;
    }
    this.blocked = null;

    // Match a recent native Play frame and observe the replay clock move.
    if (v2State !== 2) { this.candidate = null; return; }
    if (this.candidate?.map !== map || time < this.candidate.time) {
      this.candidate = { map, time };
      return;
    }
    if (confirmedCover !== true || time - this.candidate.time < 0.12) return;
    if (this.target != null && map !== this.target) {
      this.onWrong?.();
      return;
    }
    this.run = { map, time };
    this.candidate = null;
    this.change('playing');
  }
}
