const positiveId = value => Number.isSafeInteger(value) && value > 0;

export async function boundedBody(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('BEATMAP_TOO_LARGE');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('BEATMAP_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function parseBeatmapMetadata(body, id) {
  if (!positiveId(id) || !/^\uFEFF?osu file format v\d+/i.test(body)) return null;
  const sections = Object.create(null); let section = '';
  for (const line of body.split(/\r?\n/)) {
    const heading = line.trim().match(/^\[([^\]]+)\]$/);
    if (heading) { section = heading[1]; sections[section] = []; }
    else if (section && line.trim() && !line.trim().startsWith('//')) sections[section].push(line.trim());
  }
  const values = name => Object.fromEntries((sections[name] || []).flatMap(line => {
    const colon = line.indexOf(':');
    return colon < 0 ? [] : [[line.slice(0, colon).trim(), line.slice(colon + 1).trim()]];
  }));
  const metadata = values('Metadata');
  if (Number(metadata.BeatmapID) !== id) return null;
  const difficulty = values('Difficulty');
  const number = value => value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const bpms = (sections.TimingPoints || []).flatMap(line => {
    const fields = line.split(',').map(field => field.trim()); const beatLength = Number(fields[1]);
    return beatLength > 0 && (fields[6] === '1' || fields.length < 7) ? [60000 / beatLength] : [];
  }).filter(Number.isFinite);
  const setId = Number(metadata.BeatmapSetID);
  return { beatmapId: id, setId: positiveId(setId) ? setId : null, source: 'osu-file',
    stats: { cs: number(difficulty.CircleSize), hp: number(difficulty.HPDrainRate),
      ar: number(difficulty.ApproachRate), od: number(difficulty.OverallDifficulty),
      bpm: { min: bpms.length ? bpms.reduce((a, b) => Math.min(a, b)) : null, max: bpms.length ? bpms.reduce((a, b) => Math.max(a, b)) : null } } };
}

// Images and parameters share verified public-file metadata, request limits and
// cache. No OAuth key or current room is needed for original map attributes.
export function createBeatmapMetadataResolver(fetchImpl = fetch, { gapMs = 1000, now = Date.now } = {}) {
  const cache = new Map(); const pending = new Map();
  let queue = Promise.resolve(); let lastRequest = 0;
  return async id => {
    if (!positiveId(id)) return null;
    const cached = cache.get(id);
    if (cached?.until > now()) return cached.metadata;
    if (pending.has(id)) return pending.get(id);
    const task = queue.then(async () => {
      const delay = lastRequest + gapMs - now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      lastRequest = now();
      let metadata = null;
      try {
        const response = await fetchImpl(`https://osu.ppy.sh/osu/${id}`, {
          headers: { Accept: 'text/plain' }, redirect: 'error', signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('BEATMAP_UNAVAILABLE');
        metadata = parseBeatmapMetadata((await boundedBody(response, 2 * 1024 * 1024)).toString('utf8'), id);
      } catch { /* Missing official metadata remains unknown. */ }
      if (cache.size >= 240) cache.delete(cache.keys().next().value);
      cache.set(id, { metadata, until: now() + (metadata ? 86400000 : 60000) });
      return metadata;
    });
    queue = task.catch(() => {});
    pending.set(id, task);
    try { return await task; } finally { pending.delete(id); }
  };
}
