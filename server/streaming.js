// Dedicated Streamer credentials never enter persistent session state or snapshots.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizePool } from './session/model.js';
const slug = value => typeof value === 'string' && value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const text = value => typeof value === 'string' && value.length <= 500;
const check = value => { if (!value) throw new Error('INVALID_RESPONSE'); };

export function validateStreaming(body) {
  check(body?.meta?.apiVersion === '1');
  const d = body.data;
  check(d && Object.keys(d).length === 3 && Array.isArray(d.mappools));
  if (d.nextFixture === null) {
    check(d.stage === null && d.mappools.length === 0);
    return { nextFixture: null, stage: null, mappools: [] };
  }
  const f = d.nextFixture, s = d.stage;
  check(uuid(f?.id) && text(f.label) && text(f.roundName) && uuid(f.roundId) && uuid(f.stageId));
  check(['scheduled', 'in_progress'].includes(f.status) && f.result === null && Number.isFinite(Date.parse(f.scheduledAt)));
  for (const side of ['home', 'away']) {
    check(f[side] && text(f[side].label));
    const t = f[side].team;
    check(t === null || (uuid(t?.id) && text(t.name)));
  }
  check(s === null || (s && s.id === f.stageId && ['group', 'knockout'].includes(s.kind) && s.kind === f.stage &&
    s.round?.id === f.roundId && text(s.round.name)));
  const rules = s?.round.scoringRules?.series;
  check(s === null || s.round.scoringRules === null || (s.round.scoringRules?.mode === 'osu' && ['team-vs', 'head-to-head'].includes(s.round.scoringRules.teamType) && Number.isSafeInteger(s.round.scoringRules.playersPerTeam)));
  check(rules == null || (rules?.type === 'first_to' && Number.isSafeInteger(rules.wins) && rules.wins > 0) ||
    (rules?.type === 'fixed_maps' && Number.isSafeInteger(rules.count) && rules.count > 0));
  check(f.pool === null || (uuid(f.pool?.id) && text(f.pool.name)));
  check(d.mappools.length <= 1 && (!d.mappools.length || d.mappools[0].id === f.pool?.id));
  const pools = d.mappools.map(p => {
    check(uuid(p.id) && text(p.name) && Array.isArray(p.entries));
    const entries = p.entries.map(e => {
      check(uuid(e.id) && Number.isSafeInteger(e.beatmapId) && e.beatmapId > 0 &&
        ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'].includes(e.category) && Number.isSafeInteger(e.position) && e.position > 0);
      const m = e.metadata;
      check(m === null || (m && [m.title, m.artist, m.difficulty].every(v => v === null || text(v))));
      return { id: e.id, beatmapId: e.beatmapId, mod: e.category, label: `${e.category}${e.position}`,
        title: m?.title || '', artist: m?.artist || '', difficulty: m?.difficulty || '',
        ...(Number.isSafeInteger(m?.setId) && m.setId > 0 ? { setId: m.setId } : {}) };
    });
    return { id: p.id, name: p.name, entries: normalizePool(entries) };
  });
  // Project explicit fields rather than copying arbitrary upstream properties.
  return { nextFixture: { id: f.id, label: f.label, roundName: f.roundName, scheduledAt: f.scheduledAt,
    home: f.home.team ? { id: f.home.team.id, name: f.home.team.name, roster: [] } : null,
    away: f.away.team ? { id: f.away.team.id, name: f.away.team.name, roster: [] } : null },
    stage: s === null ? null : { kind: s.kind, roundName: s.round.name, playersPerTeam: s.round.scoringRules?.playersPerTeam ?? null, scoringRules: rules == null ? null :
      rules.type === 'first_to' ? { type: rules.type, wins: rules.wins } : { type: rules.type, count: rules.count } }, mappools: pools };
}

export class StreamingSource {
  #token = ''; #timer; #controller; #generation = 0; #failures = 0; #authorization = null;
  constructor({ backend, fetchImpl, readJson, notify = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
    const url = new URL(backend);
    if (url.protocol !== 'https:' || url.href !== `${url.origin}/`) throw new Error('INVALID_BACKEND_ORIGIN');
    this.backend = url.origin; this.fetch = fetchImpl; this.readJson = readJson;
    this.notify = notify; this.schedule = schedule; this.cancel = cancel;
    this.state = { status: 'disconnected', edition: null, afterFixtureId: null, updatedAt: null, error: null, data: null, tasks: [], hasMore: false };
  }
  snapshot() { return structuredClone(this.state); }
  publish(patch) { Object.assign(this.state, patch); this.notify(this.snapshot()); }
  beginAuthorization(edition, origin) {
    if (!slug(edition)) throw new Error('INVALID_EDITION');
    const local = new URL(origin);
    if (!['http:','https:'].includes(local.protocol) || !['127.0.0.1','localhost'].includes(local.hostname) || local.origin !== origin) throw new Error('INVALID_ORIGIN');
    const state = randomBytes(32).toString('base64url');
    this.#authorization = { state, edition, expiresAt: Date.now() + 600000 };
    return { state, edition, authorizationUrl: `${this.backend}/streaming/${edition}/connect?${new URLSearchParams({ origin, state })}` };
  }
  async completeAuthorization(input) {
    const pending = this.#authorization;
    if (!pending || pending.edition !== input.edition || pending.expiresAt <= Date.now() ||
        typeof input.state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.state) ||
        !timingSafeEqual(Buffer.from(input.state), Buffer.from(pending.state))) throw new Error('授权已过期或不属于本次连接，请重新登录');
    this.#authorization = null;
    return this.connect(input);
  }
  disconnect() {
    this.#generation++; this.cancel(this.#timer); this.#controller?.abort(); this.#token = ''; this.#failures = 0; this.#authorization = null;
    this.publish({ status: 'disconnected', edition: null, afterFixtureId: null, updatedAt: null, error: null, data: null, tasks: [], hasMore: false });
  }
  connect({ edition, token, afterFixtureId = null }) {
    if (!slug(edition) || !/^oclr_stream_[A-Za-z0-9_-]{43}$/.test(token) || (afterFixtureId !== null && !uuid(afterFixtureId))) throw new Error('INVALID_STREAMING_ACCESS');
    this.disconnect(); this.#token = token;
    this.publish({ status: 'connecting', edition, afterFixtureId });
    return this.poll(this.#generation);
  }
  select(fixtureId) {
    const task = this.state.tasks.find(t => t.nextFixture?.id === fixtureId);
    if (this.state.status !== 'ready' || !task) throw new Error('请等待任务读取完成后重新选择');
    this.publish({ data: task });
  }
  page(afterFixtureId) {
    if (!this.#token || (afterFixtureId !== null && (!this.state.hasMore || afterFixtureId !== this.state.tasks.at(-1)?.nextFixture.id))) throw new Error('请先连接并选择有效任务页');
    this.cancel(this.#timer); this.#controller?.abort(); this.#generation++;
    this.publish({ status: 'connecting', afterFixtureId, data: null, tasks: [], hasMore: false });
    return this.poll(this.#generation);
  }
  async poll(generation) {
    const controller = new AbortController(); this.#controller = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    let delay = 15000;
    try {
      const tasks = []; let anchor = this.state.afterFixtureId; let last;
      // Five tasks per page keep polling below the upstream request budget.
      for (let index = 0; index < 5; index++) {
        const query = anchor ? `?afterFixtureId=${anchor}` : '';
        const response = await this.fetch(`${this.backend}/api/v1/streaming/tournaments/${this.state.edition}/next${query}`, {
          method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${this.#token}` },
          credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        });
        if (generation !== this.#generation) return;
        if (!response.ok) {
          await response.body?.cancel();
          const error = new Error('STREAMING_UNAVAILABLE'); error.status = response.status;
          if (response.status === 429) {
            const retry = response.headers.get('retry-after');
            const ms = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
            delay = Number.isFinite(ms) ? Math.max(15000, ms) : 60000;
          }
          throw error;
        }
        check(/^1\.(?:[4-9]|[1-9][0-9]+)\.\d+$/.test(response.headers.get('x-oclr-read-contract') || ''));
        last = validateStreaming(await this.readJson(response));
        if (generation !== this.#generation) return;
        if (!last.nextFixture) break;
        check(last.nextFixture.id !== anchor && !tasks.some(t => t.nextFixture.id === last.nextFixture.id));
        tasks.push(last); anchor = last.nextFixture.id;
      }
      this.#failures = 0;
      this.publish({ status: 'ready', tasks, hasMore: tasks.length === 5, data: tasks.find(t => t.nextFixture.id === this.state.data?.nextFixture?.id) || tasks[0] || last,
        error: null, updatedAt: new Date().toISOString() });
    } catch (error) {
      if (generation !== this.#generation) return;
      const status = error.status;
      if ([401,403].includes(status) || (status >= 400 && status < 429)) {
        this.#token = ''; this.publish({ status: [401,403].includes(status) ? 'unauthorized' : 'error', data: null, tasks: [], hasMore: false,
          error: [401,403].includes(status) ? 'STREAMING_AUTH_REQUIRED' : 'STREAMING_SELECTION_INVALID' }); return;
      }
      delay = Math.max(delay, Math.min(120000, 15000 * 2 ** Math.min(++this.#failures, 3)));
      this.publish({ status: 'stale', data: null, tasks: [], hasMore: false, error: 'STREAMING_UNAVAILABLE' });
    } finally {
      clearTimeout(timeout);
      if (generation === this.#generation && this.#token) {
        const due = Date.now() + delay;
        const resume = () => {
          if (generation !== this.#generation) return;
          const remaining = due - Date.now();
          if (remaining > 0) this.#timer = this.schedule(resume, Math.min(remaining, 2147483647));
          else void this.poll(generation);
        };
        this.#timer = this.schedule(resume, Math.min(delay, 2147483647)); this.#timer?.unref?.();
      }
    }
  }
  importCommand(input) {
    const { data, edition, status, updatedAt } = this.state;
    if (status !== 'ready' || Date.now() - Date.parse(updatedAt) > 30000 || !data?.nextFixture || input.fixtureId !== data.nextFixture.id) throw new Error('请等候有效的直播任务资料');
    const f = data.nextFixture, rules = data.stage?.scoringRules;
    if (!f.home || !f.away || f.home.id === f.away.id) throw new Error('对阵队伍尚未确认，请等待网站发布');
    // Missing scoring does not prevent selecting a task. Preserve the current
    // manual stage/mode; known unsupported rules still require explicit correction.
    if (rules && (rules.type !== 'first_to' || ![6,7].includes(rules.wins))) throw new Error('此场赛制尚不支持自动导入，请人工核对设置');
    const players = data.stage?.playersPerTeam;
    if (players != null && ![3,4].includes(players)) throw new Error('此场人数尚不支持，请人工核对设置');
    return { id: input.id, version: input.version, type: 'import-streaming', payload: {
      title: `${edition.toUpperCase()} · ${f.label}`.slice(0,160), edition, fixtureId: f.id,
      mode: players ? `${players}v${players}` : null, poolId: data.mappools[0]?.id || null, provenance: 'oclr-streaming', teams: { a: f.home, b: f.away },
      pool: data.mappools[0]?.entries || [], stage: rules ? rules.wins === 7 ? 'final' : data.stage.kind === 'group' ? 'group' : 'elimination' : null,
    } };
  }
}
