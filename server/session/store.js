import { afterCommit } from './presentation.js';
import { scoringLive } from './scoring.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { SessionApplication } from './application.js';
import { migrateSession } from './records.js';
import { restoreAutomation, bpProgress, exhibitionProgress, seriesOf } from './model.js';

// Infrastructure owns serialization and publication, never competition rules.
export class SessionStore extends SessionApplication {
  constructor(options = {}) {
    super(options);
    this.startupChoice = options.state ? randomUUID() : null;
    this.file = options.file ?? null;
    this.persistence = this.file ? 'ready' : 'memory';
    this.listeners = new Set(); this.tail = Promise.resolve();
  }

  static async open(file) {
    let state;
    let original;
    try {
      original = await readFile(file, 'utf8');
      state = JSON.parse(original);
      if (![1, 2].includes(state.schema) || !Number.isSafeInteger(state.version) || !state.match || !Array.isArray(state.rounds) || !Array.isArray(state.commandIds)) throw new Error('INVALID_SESSION_FILE');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('SESSION_RESTORE_FAILED');
    }
    if (state?.schema === 1) {
      // Preserve the original before any upgraded snapshot can replace it.
      migrateSession(restoreAutomation(state));
      try { await writeFile(`${file}.schema-1-${createHash('sha256').update(original).digest('hex').slice(0, 12)}.bak`, original, { mode: 0o600, flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return new SessionStore({ file, state });
  }

  snapshot() {
    const { undo, commandIds, ...session } = this.state;
    const exhibition = exhibitionProgress(this.state);
    const bp = bpProgress(this.state);
    // Keep the regular cursor internally so correcting the score can resume it.
    const suspended = bp.stopped && bp.tiebreaker.eligible && !exhibition;
    return structuredClone({ roomReview: this.roomReview(), startupChoice: this.startupChoice, session: { ...session, ...(suspended ? { action: null, poolChoice: null } : {}), bp, series: seriesOf(this.state),
      ...(exhibition ? { exhibition } : {}), canUndo: undo.length > 0 }, live: scoringLive(this.state, this.live), persistence: this.persistence, catalog: this.catalog || null });
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener); }
  emit() { const value = this.snapshot(); for (const listener of this.listeners) listener(value); }
  enqueue(fn) { const task = this.tail.then(fn); this.tail = task.catch(() => {}); return task; }
  async archive() {
    if (!this.file) return;
    await mkdir(`${dirname(this.file)}/archive`, { recursive: true, mode: 0o700 });
    await writeFile(`${dirname(this.file)}/archive/${this.state.id}-${this.state.version}.json`, JSON.stringify(this.state), { mode: 0o600 });
  }
  async save(next, { allowPickScene = true } = {}) {
    if (this.file) {
      try {
        await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
        await writeFile(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
        await rename(`${this.file}.tmp`, this.file);
      } catch {
        this.persistence = 'error'; this.emit(); throw new Error('会话保存失败，操作未应用，请检查本机存储');
      }
    }
    this.persistence = this.file ? 'ready' : 'memory';
    const before = this.state;
    this.state = next;
    afterCommit(this, before, next, allowPickScene);
  }

}
