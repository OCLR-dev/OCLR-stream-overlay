import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShowcaseStore } from '../server/showcase.js';
import { parseShowcasePool } from '../server/showcase-pool.js';
import { SessionStore } from '../server/session/store.js';
import { createOverlayServer } from '../server/app.js';
import { simulationSession } from '../tools/tosu-simulator/fixture.js';

function setup(t, options) {
  const session = new SessionStore({ state: simulationSession() });
  t.after(() => session.close());
  return { session, showcase: new ShowcaseStore(session, options) };
}
const copyPool = showcase => showcase.command({ type: 'use-loaded-pool', poolToken: showcase.snapshot().poolToken, loadedPoolToken: showcase.snapshot().loadedPoolToken });
const setPool = (showcase, text) => showcase.command({ type: 'pool-text', text, poolToken: showcase.snapshot().poolToken });
function frame(session, entry, extra = {}) {
  const beatmap = { id: entry.beatmapId, title: entry.title || 'Client title', difficulty: 'Client difficulty', stats: { stars: { total: 0 }, cs: { converted: 0 } }, time: { lastObject: 0 } };
  session.live.tosu = { status: 'live', updatedAt: new Date().toISOString(), data: { beatmap, tourney: null, ...extra } };
  session.emit();
}

test('pool input accepts IDs and exact difficulty URLs, retains same-map metadata and rejects incomplete/invalid lists', () => {
  const previous = [{ id: 'old', label: 'NM1', beatmapId: 101, title: 'Old title', setId: 42, difficulty: 'Old difficulty', artist: 'Artist' }];
  const pool = parseShowcasePool('NM1 101 Title\nHD2 https://osu.ppy.sh/beatmaps/102\nHR1 https://osu.ppy.sh/beatmapsets/42#osu/103\nTB https://osu.ppy.sh/b/104', previous);
  assert.deepEqual(pool.map(entry => [entry.label, entry.beatmapId]), [['NM1', 101], ['HD2', 102], ['HR1', 103], ['TB', 104]]);
  assert.equal(pool[0].setId, 42);
  assert.equal(pool[0].difficulty, 'Old difficulty');
  const changed = parseShowcasePool('NM1 105', previous)[0];
  assert.equal(changed.setId, undefined);
  assert.equal(changed.difficulty, '');
  for (const text of ['NM1 0', 'NM1 1.5', 'NM1 9007199254740992', 'NM1 https://osu.ppy.sh/beatmapsets/42', 'NM1 https://example.org/beatmaps/101', 'NM1 101\nNM1 102', 'HD0 101', 'NM1 101\ninvalid']) {
    assert.throws(() => parseShowcasePool(text), /图池|Slot/);
  }
  assert.throws(() => parseShowcasePool(Array.from({ length: 121 }, (_, i) => `NM${i + 1} ${i + 1}`).join('\n')), /120/);
  assert.deepEqual(parseShowcasePool('  \n'), []);
});

test('the independent pool persists across restart, while current Slot follows the latest ordinary-client map without manual selection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-showcase-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'showcase.json');
  const { session, showcase } = setup(t, { file });
  const original = structuredClone(session.state);
  let matchEvents = 0;
  const stop = session.subscribe(() => matchEvents++);
  await copyPool(showcase);
  assert.equal(matchEvents, 1, 'pool import does not emit a competition event');
  assert.equal(showcase.snapshot().currentMap, null);
  for (const entry of session.state.pool.slice(0, 3)) {
    frame(session, entry);
    assert.equal(showcase.snapshot().matchedId, entry.id);
    assert.equal(showcase.snapshot().currentMap.label, entry.label);
  }
  assert.deepEqual(session.state, original);
  stop();
  const restored = new ShowcaseStore(session, { file });
  await restored.ready;
  assert.equal(restored.snapshot().matchedId, session.state.pool[2].id);
  session.live.tosu.status = 'disconnected';
  assert.equal(restored.snapshot().currentMap, null, 'the last live Slot is never persisted');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['pool', 'schema', 'stageLabel']);
  assert.equal(saved.schema, 2);
});

test('Showcase Stage persists independently and stage/pool edits preserve each other without competition events', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-showcase-stage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'showcase.json');
  const { session, showcase } = setup(t, { file });
  const original = structuredClone(session.state);
  let events = 0;
  const stop = session.subscribe(() => events++);
  assert.equal(showcase.snapshot().stageLabel, '');
  await Promise.all([
    showcase.command({ type: 'stage-label', value: '  半决赛  ' }),
    setPool(showcase, 'NM1 101'),
  ]);
  assert.equal(showcase.snapshot().stageLabel, '半决赛');
  assert.equal(showcase.snapshot().pool.length, 1);
  const restored = new ShowcaseStore(session, { file });
  await restored.ready;
  assert.equal(restored.snapshot().stageLabel, '半决赛');
  await copyPool(showcase);
  assert.equal(showcase.snapshot().stageLabel, '半决赛');
  for (const value of ['A\nB', 'X'.repeat(81), 42]) await assert.rejects(showcase.command({ type: 'stage-label', value }), /Stage/);
  await showcase.command({ type: 'stage-label', value: '' });
  assert.equal(showcase.snapshot().stageLabel, '');
  assert.equal(events, 1);
  assert.deepEqual(session.state, original);
  stop();
});

test('manual pool recording is independent of match progress and later control-pool replacement', async t => {
  const { session, showcase } = setup(t);
  await setPool(showcase, 'HD2 101 Showcase title');
  const pool = showcase.snapshot().pool;
  session.state.scene = 'playing';
  session.state.seriesAdjustment.a = 2;
  session.state.pool = [];
  session.emit();
  frame(session, pool[0]);
  assert.equal(showcase.snapshot().currentMap.label, 'HD2');
  assert.deepEqual(showcase.snapshot().pool, pool);
  await setPool(showcase, 'HR1 101 New Slot');
  assert.equal(showcase.snapshot().currentMap.label, 'HR1', 'editing the mapping updates the current Slot immediately');
  const before = showcase.snapshot().pool;
  await assert.rejects(setPool(showcase, 'HD1 101\nnot an entry'), /第 2 行/);
  assert.deepEqual(showcase.snapshot().pool, before, 'a malformed line cannot partially replace the pool');
});

test('outside-pool and duplicate-ID maps show real client metadata with an unknown Slot; old Slots cannot leak', async t => {
  const { session, showcase } = setup(t);
  await setPool(showcase, 'NM1 101\nHD2 102');
  frame(session, { beatmapId: 101 });
  assert.equal(showcase.snapshot().currentMap.label, 'NM1');
  frame(session, { beatmapId: 999 });
  assert.equal(showcase.snapshot().sourceStatus, 'unmatched');
  assert.equal(showcase.snapshot().currentMap.label, '—');
  assert.equal(showcase.snapshot().currentMap.title, 'Client title');
  assert.equal(showcase.snapshot().matchedId, null);
  await setPool(showcase, 'NM1 999\nHD2 999');
  assert.equal(showcase.snapshot().sourceStatus, 'ambiguous');
  assert.equal(showcase.snapshot().currentMap.label, '—');
  await setPool(showcase, '');
  assert.equal(showcase.snapshot().sourceStatus, 'no-pool');
  assert.equal(showcase.snapshot().currentMap.label, '—');
});

test('fresh ordinary-client identity is mandatory; empty tourney placeholders and true zero parameters are supported', async t => {
  const { session, showcase } = setup(t);
  await copyPool(showcase);
  frame(session, session.state.pool[0]);
  assert.equal(showcase.snapshot().mapParameters.stats.stars.total, 0);
  session.live.tosu.data.tourney = { ipcState: 1, teams: { left: '', right: '' }, players: [{ osuId: 0, name: '' }, { osuId: 0, name: '' }] };
  assert.equal(showcase.snapshot().sourceStatus, 'matched');
  for (const status of ['stale', 'disconnected', 'invalid-data']) {
    session.live.tosu.status = status;
    assert.equal(showcase.snapshot().currentMap, null);
    assert.equal(showcase.snapshot().mapParameters, null);
  }
  session.live.tosu.status = 'live';
  session.live.tosu.updatedAt = new Date(Date.now() - 6000).toISOString();
  assert.equal(showcase.snapshot().currentMap, null);
  session.live.tosu.updatedAt = new Date().toISOString();
  for (const tourney of [{ ipcState: 3, teams: { left: 'A', right: 'B' } }, { players: [{ osuId: 123 }] }, { teams: { left: 'A', right: '' } }]) {
    session.live.tosu.data.tourney = tourney;
    assert.equal(showcase.snapshot().sourceStatus, 'tourney');
    assert.equal(showcase.snapshot().currentMap, null);
  }
  session.live.tosu.data.tourney = null;
  session.live.tosu.data.beatmap.id = 0;
  assert.equal(showcase.snapshot().sourceStatus, 'no-map');
  assert.equal(showcase.snapshot().currentMap, null);
});

test('old manual-selection settings migrate to a pool and ignore the selected Slot', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-showcase-migrate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'showcase.json');
  await writeFile(file, JSON.stringify({ poolToken: 'previous', selectedId: 'old-selection', useTosu: false }));
  const { session, showcase } = setup(t, { file });
  await showcase.ready;
  assert.deepEqual(showcase.snapshot().pool, session.state.pool);
  assert.equal(showcase.snapshot().currentMap, null);
  frame(session, session.state.pool[1]);
  assert.equal(showcase.snapshot().matchedId, session.state.pool[1].id);
});

test('bad settings, stale pool imports and conflicting pool edits do not overwrite either store', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-showcase-bad-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'showcase.json');
  await writeFile(file, 'broken original');
  const { session, showcase } = setup(t, { file });
  const original = structuredClone(session.state);
  await showcase.ready;
  await assert.rejects(copyPool(showcase), /无法读取/);
  assert.equal(await readFile(file, 'utf8'), 'broken original');
  assert.deepEqual(session.state, original);
  const separate = new ShowcaseStore(session);
  const initial = separate.snapshot();
  await setPool(separate, 'NM1 101');
  await assert.rejects(separate.command({ type: 'pool-text', text: '', poolToken: initial.poolToken }), /已更新/);
  const last = separate.snapshot();
  session.state.pool = [];
  await assert.rejects(separate.command({ type: 'use-loaded-pool', poolToken: last.poolToken, loadedPoolToken: last.loadedPoolToken }), /尚未加载/);
  assert.equal(separate.snapshot().pool.length, 1);
});

test('separate SSE outputs follow source map changes, pool writes stay same-origin and media is scoped to recorded maps', async t => {
  const { session } = setup(t);
  session.state.pool[0].setId = 42;
  const config = { port: 0 };
  const server = createOverlayServer(config, async () => { throw new Error('No network in regression'); }, undefined, session);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  const abort = new AbortController();
  t.after(() => { abort.abort(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const streams = await Promise.all([0, 1].map(() => fetch(base + '/api/showcase/events', { signal: abort.signal })));
  const readers = streams.map(response => response.body.getReader());
  await Promise.all(readers.map(reader => reader.read()));
  const original = structuredClone(session.state);
  const initial = await fetch(base + '/api/showcase').then(r => r.json());
  const input = { type: 'use-loaded-pool', poolToken: initial.poolToken, loadedPoolToken: initial.loadedPoolToken };
  const post = (body, headers = {}) => fetch(base + '/api/showcase', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post(JSON.stringify(input), { Origin: 'https://example.org' })).status, 403);
  assert.equal((await post('x'.repeat(256 * 1024 + 1))).status, 413);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post(JSON.stringify(input))).status, 200);
  await Promise.all(readers.map(reader => reader.read()));
  for (const entry of session.state.pool.slice(0, 2)) {
    frame(session, entry);
    for (const reader of readers) {
      const message = new TextDecoder().decode((await reader.read()).value);
      assert.match(message, new RegExp(`"matchedId":"${entry.id}"`));
    }
  }
  assert.deepEqual(session.state, original);
  assert.equal((await fetch(base + '/api/showcase?token=x')).status, 400);
  assert.equal((await fetch(base + '/api/showcase', { method: 'DELETE' })).status, 405);
  session.state.pool = [];
  const snapshot = await fetch(base + '/api/showcase').then(r => r.json());
  assert.ok(snapshot.pool.length > 0, 'copying the pool detaches it from competition state');
  const cover = await fetch(base + `/api/beatmaps/${snapshot.pool[0].beatmapId}/cover`, { redirect: 'manual' });
  assert.equal(cover.status, 302, 'the recorded Showcase pool keeps its verified cover access');
  assert.equal((await fetch(base + '/api/beatmaps/99999999/cover')).status, 404);
  abort.abort();
});

test('Showcase attaches to the session restored after the portable HTTP server has bound', async t => {
  const { session } = setup(t);
  const config = { port: 0 };
  const server = createOverlayServer(config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.port = server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${config.port}/api/showcase`;
  assert.equal((await fetch(url)).status, 503);
  config.session = session;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).loadedPoolCount, session.state.pool.length);
});

const websiteId = n => `86100000-8000-4000-8000-${String(n).padStart(12, '0')}`;
const websiteToken = 'oclr_stream_' + 'a'.repeat(43);
const coverEntryId = websiteId(6);
const websitePath = '/api/v1/streaming/tournaments/s11/showcase/pools';
const authorizedPool = { id: websiteId(1), name: 'Preview pool', version: 7, updatedAt: '2026-11-15T17:00:00.000Z',
  stage: { id: websiteId(2), kind: 'knockout' }, round: { id: websiteId(3), name: 'Semifinals', position: 2 }, entryCount: 3 };
const protectedCover = `${websitePath}/${authorizedPool.id}/covers/${coverEntryId}?version=7`;
const privateEntries = [
  { slot: 'NM1', category: 'NM', position: 1, beatmapId: 704001, title: 'First', difficulty: 'Expert', coverUrl: protectedCover },
  { slot: 'HD1', category: 'HD', position: 1, beatmapId: 704002, title: 'Second', difficulty: 'Insane', coverUrl: null },
  { slot: 'FM1', category: 'FM', position: 1, beatmapId: 704002, title: 'Second', difficulty: 'Insane', coverUrl: null },
];
const websiteJson = (data, version = '1.37.0') => Response.json({ data, meta: { apiVersion: '1' } }, { headers: { 'X-OCLR-Read-Contract': version } });

async function serveWebsiteShowcase(t, fetchImpl, file) {
  const { session } = setup(t);
  if (file) session.file = join(file, 'session.json');
  const config = { port: 0 };
  const server = createOverlayServer(config, (resource, options) => {
    const url = new URL(resource);
    assert.equal(url.origin, 'https://oclr.org');
    assert.ok([websiteToken, websiteToken.replace(/a$/, 'b')].some(token => options.headers.Authorization === `Bearer ${token}`));
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return url.pathname.endsWith('/next') ?
      websiteJson({ nextFixture: null, stage: null, mappools: [] }) : fetchImpl(url);
  }, undefined, session);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const get = path => fetch(base + path);
  const send = (path, input, headers = {}) => fetch(base + path, { method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
  const snapshot = () => get('/api/showcase').then(response => response.json());
  const status = () => get('/api/showcase/website').then(response => response.json());
  async function login(token = websiteToken) {
    const response = await send('/api/streaming', { action: 'connect', edition: 's11', token });
    assert.equal((await response.json()).data.nextFixture, null);
    return status();
  }
  return { session, get, send, snapshot, status, login };
}

test('website list and preview are read-only without fixture assignments; explicit import persists only Showcase and rechecks protected artwork', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-showcase-website-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let revoked = false;
  let detailReads = 0;
  const paths = [];
  const h = await serveWebsiteShowcase(t, url => {
    const path = url.pathname + url.search;
    paths.push(path);
    if (path === websitePath) return websiteJson({ pools: [authorizedPool] });
    if (path === protectedCover) return revoked ? new Response(null, { status: 404 }) :
      new Response(Uint8Array.of(255, 216, 255, 217), { headers: { 'Content-Type': 'image/jpeg', 'X-OCLR-Read-Contract': '1.37.0' } });
    assert.equal(path, `${websitePath}/${authorizedPool.id}?version=7`);
    detailReads++;
    return revoked ? new Response(null, { status: 404 }) : websiteJson({ pool: authorizedPool, entries: privateEntries });
  }, dir);
  const originalMatch = structuredClone(h.session.state);
  assert.equal((await h.send('/api/showcase/website', { action: 'list', edition: 's11', connection: 'old' })).status, 401);
  const auth = await h.login();
  assert.equal(auth.edition, 's11');
  assert.ok(!JSON.stringify(auth).includes(websiteToken));
  const selected = { ...auth, poolId: authorizedPool.id, version: 7 };
  await h.send('/api/showcase', { type: 'stage-label', value: 'Existing Stage' });
  const current = await h.snapshot();
  assert.equal((await h.send('/api/showcase/website', { action: 'list', ...auth }, { Origin: 'https://example.org' })).status, 403);
  const list = await h.send('/api/showcase/website', { action: 'list', ...auth });
  assert.equal(list.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual((await list.json()).pools, [authorizedPool]);
  const preview = await h.send('/api/showcase/website', { action: 'preview', ...selected });
  assert.deepEqual(await preview.json(), { pool: authorizedPool });
  assert.deepEqual(await h.snapshot(), current);
  const importInput = { type: 'import-website', ...selected, poolToken: current.poolToken };
  revoked = true;
  assert.equal((await h.send('/api/showcase', importInput)).status, 404, 'import must recheck access after preview');
  assert.deepEqual(await h.snapshot(), current);
  revoked = false;
  const imported = await h.send('/api/showcase', importInput);
  assert.equal(imported.status, 200);
  const result = await imported.json();
  assert.equal(detailReads, 3);
  assert.equal(result.stageLabel, 'Existing Stage');
  assert.equal(result.websitePool.version, 7);
  assert.deepEqual(result.pool.map(p => [p.label, p.beatmapId, p.title, p.difficulty]),
    privateEntries.map(entry => [entry.slot, entry.beatmapId, entry.title, entry.difficulty]));
  assert.deepEqual(h.session.state, originalMatch);
  const restored = new ShowcaseStore(h.session);
  await restored.ready;
  assert.deepEqual(restored.snapshot().websitePool, result.websitePool);
  assert.deepEqual(restored.snapshot().pool, result.pool);
  assert.equal(restored.snapshot().stageLabel, 'Existing Stage');
  const persisted = await readFile(join(dir, 'showcase.json'), 'utf8');
  assert.ok(!persisted.includes(websiteToken) && !persisted.includes(websitePath));

  frame(h.session, { beatmapId: 704001 });
  const matched = await h.snapshot();
  assert.equal(matched.currentMap.label, 'NM1');
  assert.equal(matched.currentMap.title, 'First');
  assert.equal(matched.currentMap.difficulty, 'Expert');
  const img = await h.get(matched.websiteArtwork);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), Uint8Array.of(255, 216, 255, 217));
  assert.equal((await h.get('/api/beatmaps/704001/cover')).status, 404, 'website membership cannot open a public cover lookup');
  assert.equal((await h.get(matched.websiteArtwork.replace(coverEntryId, websiteId(98)))).status, 404);
  frame(h.session, { beatmapId: 704002 });
  assert.equal((await h.snapshot()).sourceStatus, 'ambiguous');
  frame(h.session, { beatmapId: 704003 });
  assert.equal((await h.snapshot()).sourceStatus, 'unmatched');

  revoked = true;
  assert.equal((await h.get(matched.websiteArtwork)).status, 404);
  await h.send('/api/streaming', { action: 'disconnect' });
  assert.equal((await h.get(matched.websiteArtwork)).status, 401);
  assert.equal(paths.filter(path => path === protectedCover).length, 2, 'no artwork fallback or request after disconnect');
  assert.deepEqual((await h.snapshot()).pool, result.pool);
  assert.deepEqual(h.session.state, originalMatch);
});

test('auth switches, invalid contract, versions and late reads cannot replace the local Showcase pool', async t => {
  let read;
  const h = await serveWebsiteShowcase(t, url => {
    if (url.pathname === websitePath) return websiteJson({ pools: [] });
    return read();
  });
  const auth = await h.login();
  const preview = { ...auth, poolId: authorizedPool.id, version: 7 };
  assert.deepEqual(await (await h.send('/api/showcase/website', { action: 'list', ...auth })).json(), { pools: [] });
  const initial = await h.snapshot();
  const importPool = (selection = preview) => h.send('/api/showcase', { type: 'import-website', ...selection, poolToken: initial.poolToken });
  read = () => new Response(null, { status: 409 });
  assert.equal((await importPool()).status, 409);
  read = () => websiteJson({ pool: authorizedPool, entries: privateEntries }, '1.36.0');
  assert.equal((await importPool()).status, 502);
  read = () => websiteJson({ pool: authorizedPool, entries: [{ ...privateEntries[0], coverUrl: 'https://example.org/image.jpg' }, ...privateEntries.slice(1)] });
  assert.equal((await importPool()).status, 502);
  assert.deepEqual(await h.snapshot(), initial);
  const deferred = () => {
    const entered = Promise.withResolvers();
    const finish = Promise.withResolvers();
    read = () => { entered.resolve(); return finish.promise; };
    return { entered: entered.promise, finish: () => finish.resolve(websiteJson({ pool: authorizedPool, entries: privateEntries })) };
  };
  const older = deferred();
  const late = importPool();
  await older.entered;
  const laterAuth = await h.login(websiteToken.replace(/a$/, 'b'));
  assert.notEqual(laterAuth.connection, auth.connection);
  older.finish();
  assert.equal((await late).status, 401);
  assert.deepEqual(await h.snapshot(), initial);
  const another = deferred();
  const concurrent = importPool({ ...preview, ...laterAuth });
  await another.entered;
  const saved = await h.send('/api/showcase', { type: 'pool-text', text: 'HD2 89898 My manual edit', poolToken: initial.poolToken });
  assert.equal(saved.status, 200);
  another.finish();
  assert.equal((await concurrent).status, 409);
  assert.equal((await h.snapshot()).poolText, 'HD2 89898 My manual edit');
});
