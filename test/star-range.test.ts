import test from 'node:test';
import assert from 'node:assert/strict';
import { starRatingDisplay, starRatingRangeDisplay } from '../ui/mapStats.ts';
import { normalizeTosuV2 } from '../src/tosu.js';
import { liveBeatmap } from '../ui/liveScores.ts';
import { mapParameterDisplay } from '../ui/mapParameters.ts';
import { SessionStore } from '../server/session/store.js';

const raw = (ipc = 3, stars: Array<number | null> = [5.53, 5.93]) => ({ state: { number: 2, name: 'Playing' }, beatmap: { id: 101, checksum: 'fm', stats: { stars: { total: 5.53 } } },
  tourney: { ipcState: ipc, team: { left: 'L', right: 'R' }, clients: stars.map((total, i) => ({ team: i ? 'right' : 'left', user: { id: i + 1 },
    play: { mods: { name: i ? 'HR' : 'HD' } }, beatmap: { id: 101, stats: { stars: { total } } } })) } });
const displayed = (store: SessionStore) => {
  const map = liveBeatmap(store.snapshot() as any, 'synced');
  const parameters = mapParameterDisplay(101, 'tosu', map, null, 'FM');
  const big = parameters.rangeMode ? starRatingRangeDisplay(map?.stats?.ranges?.stars) : starRatingDisplay(map?.stats?.stars?.total);
  return { big, parameter: parameters.rows[0]!.value };
};

test('the big FM star uses the complete player range even when the shared scalar is null, including Ranking cleanup', async () => {
  const store = new SessionStore();
  await store.frame(normalizeTosuV2(raw()), 1000);
  const map = liveBeatmap(store.snapshot() as any, 'synced'); assert.equal(map?.stats?.stars?.total, null);
  assert.equal(displayed(store).big.value, '5.53–5.93'); assert.equal(displayed(store).parameter, displayed(store).big.value);
  assert.deepEqual(displayed(store).big.color, starRatingDisplay(5.93).color);
  await store.frame(normalizeTosuV2(raw(4, [null, null])), 1200);
  assert.equal(displayed(store).big.value, '5.53–5.93');
  await store.sourceStatus('disconnected'); await store.frame(normalizeTosuV2(raw(4, [null, null])), 1300);
  assert.equal(displayed(store).big.value, '—', 'no range may be inherited across reconnect');
});

test('equal stars and real zero collapse; incomplete, invalid and wrong-map ranges never become a root NM fallback', async () => {
  assert.equal(starRatingRangeDisplay({ min: 0, max: 0 }).value, '0');
  assert.equal(starRatingRangeDisplay({ min: 5.53, max: 5.53 }).value, '5.53');
  for (const range of [null, undefined, { min: -1, max: 5 }, { min: 6, max: 5 }, { min: NaN, max: 5 }, { min: 5, max: Infinity }]) assert.equal(starRatingRangeDisplay(range).value, '—');
  for (const wrongMap of [false, true]) {
    const store = new SessionStore(); const frame = raw(3, [5.53, null]);
    if (wrongMap) frame.tourney.clients[1]!.beatmap.id = 999;
    await store.frame(normalizeTosuV2(frame), 1000);
    assert.equal(displayed(store).big.value, '—');
  }
});
