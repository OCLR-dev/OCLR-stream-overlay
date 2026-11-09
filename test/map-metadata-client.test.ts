import test from 'node:test';
import assert from 'node:assert/strict';
import { mapFileMetadata } from '../ui/mapMetadata.ts';

test('metadata failures can recover; concurrent and successful reads remain shared', async t => {
  let requests = 0;
  const id = 900001;
  let recover = false;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    if (!recover) return new Response('', { status: 503 });
    return Response.json({ beatmapId: id, source: 'osu-file', calculation: { mod: 'NM', stars: 5.25 } });
  });
  const first = mapFileMetadata(id, 'NM');
  assert.equal(mapFileMetadata(id, 'NM'), first);
  assert.equal(await first, null);
  recover = true;
  const retry = await mapFileMetadata(id, 'NM');
  assert.equal(retry?.calculation?.stars, 5.25);
  assert.equal(requests, 2);
  assert.equal(await mapFileMetadata(id, 'NM'), retry);
  assert.equal(requests, 2);
});

test('network, invalid JSON and wrong-map responses do not leave permanent negative entries', async t => {
  for (const failure of ['network', 'json', 'map']) {
    const id = { network: 900002, json: 900003, map: 900004 }[failure]!;
    let requests = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => {
      if (++requests === 1) {
        if (failure === 'network') throw new Error('offline');
        if (failure === 'json') return new Response('invalid JSON');
        return Response.json({ beatmapId: id + 1, source: 'osu-file' });
      }
      return Response.json({ beatmapId: id, source: 'osu-file' });
    });
    assert.equal(await mapFileMetadata(id, 'NM'), null);
    assert.equal((await mapFileMetadata(id, 'NM'))?.beatmapId, id);
    assert.equal(requests, 2);
    mock.mock.restore();
  }
});
