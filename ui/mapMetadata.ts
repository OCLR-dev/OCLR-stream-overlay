import type { TestMapMetadata } from './mapParameters';

const cache = new Map<number, Promise<TestMapMetadata | null>>();
const queue: Array<() => void> = [];
let active = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      task().then(resolve, reject).finally(() => {
        active -= 1;
        queue.shift()?.();
      });
    };
    if (active < 2) run();
    else queue.push(run);
  });
}

// The public .osu file is the only source for archived pools whose metadata
// omits the difficulty name. Keep one request per beatmap for the whole overlay,
// and avoid filling every browser connection while the server rate-limits reads.
export function mapFileMetadata(beatmapId: number): Promise<TestMapMetadata | null> {
  if (!Number.isSafeInteger(beatmapId) || beatmapId <= 0) return Promise.resolve(null);
  const existing = cache.get(beatmapId);
  if (existing) return existing;
  const request = schedule(() => fetch(`/api/beatmaps/${beatmapId}/metadata`)
    .then(async response => {
      if (!response.ok) return null;
      const value = await response.json() as TestMapMetadata;
      return value?.beatmapId === beatmapId && value.source === 'osu-file' ? value : null;
    })
    .catch(() => null));
  cache.set(beatmapId, request);
  return request;
}
