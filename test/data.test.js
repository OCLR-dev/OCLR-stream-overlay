import test from 'node:test';
import assert from 'node:assert/strict';
import { OclrClient, OclrError } from '../src/oclr.js';
import { TosuClient, normalizeTosuV2 } from '../src/tosu.js';
import { BroadcastData, findPoolEntry } from '../src/broadcast.js';

const VERSION_A = 'a'.repeat(64);
const VERSION_B = 'b'.repeat(64);
const envelope = (data, pagination) => ({ data, meta: { apiVersion: '1', ...(pagination ? { pagination } : {}) } });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const page = (data, current, total, version) => envelope(data, {
  page: current, pageSize: 100, total, totalPages: Math.ceil(total / 100),
  nextPage: current * 100 < total ? current + 1 : null, collectionVersion: version,
});
const frame = { state: { number: 2, name: 'Playing' }, beatmap: { id: 42 }, tourney: {
  points: { left: 0 }, totalScore: { left: 0, right: 900 }, clients: [{ team: 'left', user: { id: 7 }, play: { score: 0, accuracy: 0 } }],
} };
const snapshot = () => ({ teams: [], competition: { fixtures: [] }, mappools: [], players: [], bracket: null, overview: {} });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

test('paginated read sends a revision and discards all partial data after a conflict', async () => {
  const calls = [];
  const responses = [page(Array(100).fill('old'), 1, 101, VERSION_A),
    { error: { code: 'COLLECTION_CHANGED' } }, page(['new'], 1, 1, VERSION_B)];
  const client = new OclrClient({ fetchImpl: async url => {
    calls.push(url);
    const data = responses.shift();
    return json(data, data.error ? 409 : 200);
  } });
  assert.deepEqual(await client.tournaments(), ['new']);
  assert.match(calls[1], new RegExp(`version=${VERSION_A}`));
  assert.doesNotMatch(calls[2], /version=/);
});

test('incomplete and malformed collections fail instead of rendering partial data', async () => {
  const client = new OclrClient({ fetchImpl: async () => json(page(['partial'], 1, 101, VERSION_A)) });
  await assert.rejects(client.tournaments(), { code: 'INVALID_PAGINATION' });
});

test('401 does not trigger anonymous fallback, and 429 preserves retry interval', async () => {
  let calls = 0;
  const client = new OclrClient({ fetchImpl: async () => { calls++; return json({ error: { code: 'INVALID_TOKEN' } }, 401); } });
  await assert.rejects(client.tournaments(), { status: 401, code: 'INVALID_TOKEN' });
  assert.equal(calls, 1);
  client.fetchImpl = async () => json({ error: { code: 'RATE_LIMITED' } }, 429, { 'Retry-After': '90' });
  await assert.rejects(client.tournaments(), { retryAfterMs: 90000 });
});

test('tosu distinguishes zero, absent data, and an absent tournament client', () => {
  const data = normalizeTosuV2(frame);
  assert.equal(data.tourney.totalScore.left, 0);
  assert.equal(data.tourney.points.right, null);
  assert.equal(data.tourney.players[0].accuracy, 0);
  assert.equal(normalizeTosuV2({ ...frame, tourney: null }).tourney, null);
  assert.throws(() => normalizeTosuV2({ error: 'not ready' }));
});

test('tosu map stats preserve zero and normalize missing or nonnumeric fields without fallback', () => {
  const raw = { ...frame, beatmap: { id: 42, time: { lastObject: 245000 }, stats: {
    stars: { live: 2.1, total: 7.35 }, cs: { original: 4, converted: 0 },
    ar: { original: 9, converted: '10.3' }, od: { converted: NaN },
    bpm: { realtime: 180, common: Infinity },
  } } };
  const map = normalizeTosuV2(raw).beatmap;
  assert.equal(map.stats.stars.total, 7.35);
  assert.equal(map.stats.cs.converted, 0);
  assert.equal(map.stats.ar.converted, null);
  assert.equal(map.stats.od.converted, null);
  assert.equal(map.stats.bpm.common, null);
  assert.equal(map.time.lastObject, 245000);
  assert.equal(map.time.firstObject, null);
  assert.equal(normalizeTosuV2(frame).beatmap.stats, null);
  assert.equal(normalizeTosuV2(frame).beatmap.time.lastObject, null);
  assert.equal(raw.beatmap.stats.ar.converted, '10.3', 'normalization does not mutate raw frames');
});

test('map lookup stays within the selected pool and requires a slot for repeated maps', () => {
  const data = { mappools: [
    { id: 'first', entries: [{ id: 'a', beatmapId: 42 }, { id: 'b', beatmapId: 42 }] },
    { id: 'second', entries: [{ id: 'c', beatmapId: 42 }] },
  ] };
  assert.equal(findPoolEntry(data, { poolId: 'first' }, 42), null);
  assert.equal(findPoolEntry(data, { poolId: 'first', entryId: 'b' }, 42).id, 'b');
  assert.equal(findPoolEntry(data, { poolId: 'second' }, 42).id, 'c');
  assert.equal(findPoolEntry(data, {}, 42), null);
});

test('switching editions discards a late previous response and clears match selections', async () => {
  const first = deferred();
  const data = new BroadcastData({ oclr: { edition: slug => slug === 's8' ? first.promise : Promise.resolve(snapshot()) } });
  const old = data.selectEdition('s8');
  await data.selectEdition('s11');
  first.resolve({ ...snapshot(), overview: { old: true } });
  await old;
  assert.equal(data.getSnapshot().selection.edition, 's11');
  assert.deepEqual(data.getSnapshot().oclr.data.overview, {});
  assert.equal(data.getSnapshot().selection.fixtureId, null);
  data.stop();
});

test('authorization failures clear the previously successful snapshot', async () => {
  let reject = false;
  const data = new BroadcastData({ oclr: { edition: async () => {
    if (reject) throw new OclrError('INVALID_TOKEN', 401);
    return snapshot();
  } } });
  await data.selectEdition('s11');
  assert.equal(data.getSnapshot().oclr.status, 'ready');
  reject = true;
  await data.refresh();
  assert.equal(data.getSnapshot().oclr.status, 'blocked');
  assert.equal(data.getSnapshot().oclr.data, null);
  data.stop();
});

test('subscribers cannot mutate source state and unavailable publication clears selections', async () => {
  let result = { ...snapshot(), teams: [{ id: 'left' }], mappools: [{ id: 'pool', entries: [] }] };
  const data = new BroadcastData({ oclr: { edition: async () => result } });
  data.subscribe(state => { state.selection.edition = 'modified'; });
  await data.selectEdition('s11');
  data.selectMatch({ poolId: 'pool', leftTeamId: 'left' });
  result = snapshot();
  await data.refresh();
  assert.equal(data.getSnapshot().selection.edition, 's11');
  assert.equal(data.getSnapshot().selection.poolId, null);
  assert.equal(data.getSnapshot().selection.leftTeamId, null);
  data.stop();
});

class FakeSocket {
  static sockets = [];
  constructor() { FakeSocket.sockets.push(this); }
  close() { this.onclose?.(); }
}

test('WebSocket silence marks stale, reconnects, and stop cancels reconnect', async () => {
  const statuses = [];
  const client = new TosuClient({ url: 'ws://example', WebSocketImpl: FakeSocket,
    staleMs: 15, reconnectMs: 5, onStatus: status => statuses.push(status), onFrame() {} });
  client.start();
  FakeSocket.sockets.at(-1).onmessage({ data: JSON.stringify(frame) });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(statuses.includes('live'));
  assert.ok(statuses.includes('stale'));
  assert.ok(FakeSocket.sockets.length >= 2);
  client.stop();
  const count = FakeSocket.sockets.length;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(FakeSocket.sockets.length, count);
  assert.equal(statuses.at(-1), 'stopped');
});

test('historical editions read the published configuration archive without replacing empty live resources', async () => {
  const calls = [];
  const archive = { editionSlug: 's10', teams: [], pools: [] };
  const client = new OclrClient({ fetchImpl: async url => {
    calls.push(url);
    const path = new URL(url, 'http://local.test').pathname;
    if (path.endsWith('/players')) return json(page([], 1, 0, VERSION_A));
    if (path.endsWith('/configuration')) return json(envelope({ edition: { archive } }));
    if (path.endsWith('/s10')) return json(envelope({ slug: 's10', overview: { kind: 'historical_archive' } }));
    return json(envelope(path.endsWith('/bracket') ? null : []));
  } });
  const result = await client.edition('s10');
  assert.deepEqual(result.configuration.edition.archive, archive);
  assert.deepEqual(result.teams, []); assert.deepEqual(result.mappools, []);
  assert.equal(calls.filter(url => url.includes('/configuration')).length, 1);
  calls.length = 0;
  await client.edition('s11');
  assert.equal(calls.some(url => url.includes('/configuration')), false);
});
