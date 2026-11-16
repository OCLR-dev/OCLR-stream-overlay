import { boundedBody } from './beatmap-metadata.js';
import { showcasePool } from './showcase-pool.js';

const limit = 2 * 1024 * 1024;
const uuidPattern = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const uuid = value => typeof value === 'string' && new RegExp(`^${uuidPattern}$`, 'i').test(value);
const editionSlug = value => typeof value === 'string' && value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const versionOk = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const text = (value, max = 500) => typeof value === 'string' && value.length <= max && !/[\r\n\u0000]/.test(value);
const poolPath = edition => `/api/v1/streaming/tournaments/${edition}/showcase/pools`;

class WebsitePoolError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

const invalid = () => new WebsitePoolError('INVALID_SHOWCASE_DATA', '网站图池资料格式有误，请刷新图池列表后重试。', 502);
const authChanged = () => new WebsitePoolError('SHOWCASE_LOGIN_REQUIRED', 'OCLR 授权已失效或已切换，请重新读取图池。', 401);
const gone = () => new WebsitePoolError('SHOWCASE_POOL_UNAVAILABLE', '此图池目前无法读取，请刷新列表或联系赛事管理员。', 404);

function readPool(value) {
  if (!uuid(value?.id) || !text(value.name) || !versionOk(value.version) ||
      !Number.isFinite(Date.parse(value.updatedAt)) || !uuid(value.stage?.id) ||
      !['group', 'knockout', 'exhibition'].includes(value.stage.kind) ||
      !uuid(value.round?.id) || !text(value.round.name) ||
      !Number.isSafeInteger(value.round.position) || value.round.position < 1 ||
      !Number.isSafeInteger(value.entryCount) || value.entryCount < 0) throw invalid();
  return { id: value.id, name: value.name, version: value.version, updatedAt: value.updatedAt,
    stage: { id: value.stage.id, kind: value.stage.kind },
    round: { id: value.round.id, name: value.round.name, position: value.round.position }, entryCount: value.entryCount };
}

export function restoredWebsitePool(source, entries) {
  if (!editionSlug(source?.edition) || !Array.isArray(source.covers)) throw invalid();
  const pool = readPool(source.pool);
  const slots = new Set(entries.map(entry => entry.label));
  const ids = new Set();
  const covers = source.covers.map(({ slot, entryId }) => {
    if (!slots.delete(slot) || !uuid(entryId) || ids.has(entryId)) throw invalid();
    ids.add(entryId);
    return { slot, entryId };
  });
  if (pool.entryCount !== entries.length) throw invalid();
  return { edition: source.edition, pool, covers };
}

function readDetail(value, edition, id, version) {
  const pool = readPool(value?.pool);
  if (pool.id !== id || pool.version !== version ||
      !Array.isArray(value.entries) || value.entries.length !== pool.entryCount || pool.entryCount > 120) throw invalid();
  const covers = [];
  const coverPattern = new RegExp(`^${poolPath(edition)}/${id}/covers/(${uuidPattern})\\?version=${version}$`, 'i');
  const entries = showcasePool(value.entries.map(entry => {
    if (!Number.isSafeInteger(entry?.position) || entry.position < 1 || entry.slot !== `${entry.category}${entry.position}` ||
        !text(entry.title, 300) || !text(entry.difficulty, 300)) throw invalid();
    if (entry.coverUrl !== null) {
      const entryId = typeof entry.coverUrl === 'string' && coverPattern.exec(entry.coverUrl)?.[1];
      if (!entryId) throw invalid();
      covers.push({ slot: entry.slot, entryId });
    }
    return { id: entry.slot, label: entry.slot, mod: entry.category, beatmapId: entry.beatmapId, title: entry.title, difficulty: entry.difficulty };
  }));
  return { entries, source: restoredWebsitePool({ edition, pool, covers }, entries) };
}

/** The credential is owned by StreamingSource. A read never falls back to the public API. */
export async function readWebsiteShowcase({ backend, edition, token, isCurrent, fetchImpl, readJson }, request) {
  if (!isCurrent()) throw authChanged();
  const { poolId, version, entryId } = request;
  if (poolId !== undefined && (!uuid(poolId) || !versionOk(version))) throw invalid();
  if (entryId !== undefined && (!poolId || !uuid(entryId))) throw invalid();
  const path = poolPath(edition) + (poolId ? `/${poolId}${entryId ? `/covers/${entryId}` : ''}?version=${version}` : '');
  try {
    const response = await fetchImpl(backend + path, {
      method: 'GET', headers: { Accept: entryId ? 'image/jpeg, image/png, image/webp' : 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!isCurrent() || !response.ok) {
      await response.body?.cancel();
      if (!isCurrent() || response.status === 401) throw authChanged();
      if (response.status === 403) throw new WebsitePoolError('SHOWCASE_FORBIDDEN', '此账号没有提前读取图池的权限，请联系赛事管理员。', 403);
      if (response.status === 404) throw gone();
      if (response.status === 409) throw new WebsitePoolError('SHOWCASE_VERSION_CHANGED', '网站图池版本已更新，请刷新列表后重新确认。', 409);
      if (response.status === 429) throw new WebsitePoolError('SHOWCASE_RATE_LIMIT', '读取过于频繁，请稍候再试。', 429);
      throw new Error();
    }
    const contract = /^1\.(\d+)\.\d+$/.exec(response.headers.get('x-oclr-read-contract') || '');
    if (!contract || Number(contract[1]) < 37) {
      await response.body?.cancel();
      throw new WebsitePoolError('SHOWCASE_API_UNAVAILABLE', '网站的 Showcase 接口尚不可用，请稍后重试。', 502);
    }
    let result;
    if (entryId) {
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
        await response.body?.cancel(); throw invalid();
      }
      result = { type, bytes: await boundedBody(response, limit) };
      if (!result.bytes.length) throw invalid();
    } else {
      const body = await readJson(response);
      if (body?.meta?.apiVersion !== '1') throw invalid();
      if (poolId) result = readDetail(body.data, edition, poolId, version);
      else {
        if (!Array.isArray(body.data?.pools)) throw invalid();
        result = body.data.pools.map(readPool);
        if (new Set(result.map(pool => pool.id)).size !== result.length) throw invalid();
      }
    }
    if (!isCurrent()) throw authChanged();
    return result;
  } catch (error) {
    if (!isCurrent()) throw authChanged();
    if (error instanceof WebsitePoolError) throw error;
    throw new WebsitePoolError('SHOWCASE_UNAVAILABLE', '暂时无法读取网站图池，请稍后重试。', 502);
  }
}
