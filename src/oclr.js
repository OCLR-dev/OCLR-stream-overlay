export class OclrError extends Error {
  constructor(code, status = 0, retryAfterMs = 0) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class OclrClient {
  constructor({ baseUrl = '/api/oclr', fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async read(resource, query = {}, signal) {
    const params = new URLSearchParams(query);
    const response = await this.fetchImpl(`${this.baseUrl}/${resource}${params.size ? `?${params}` : ''}`, {
      credentials: 'omit', cache: 'no-store', signal,
    });
    let body;
    try { body = await response.json(); }
    catch { throw new OclrError('INVALID_RESPONSE', response.status); }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const retryAfterMs = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 0;
      throw new OclrError(body?.error?.code || 'API_ERROR', response.status, retryAfterMs || 0);
    }
    if (!body || !Object.hasOwn(body, 'data') || body.meta?.apiVersion !== '1') throw new OclrError('INVALID_RESPONSE');
    return body;
  }

  async collection(resource, signal) {
    // A revision conflict restarts the entire read once; never return partial pages.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const all = [];
        let page = 1;
        let version;
        let total;
        while (page !== null) {
          if (page > 100) throw new OclrError('COLLECTION_TOO_LARGE');
          const body = await this.read(resource, { page: String(page), pageSize: '100', ...(version ? { version } : {}) }, signal);
          const p = body.meta.pagination;
          if (!Array.isArray(body.data) || !p || p.page !== page || p.pageSize !== 100 ||
              !/^[a-f0-9]{64}$/.test(p.collectionVersion) ||
              !Number.isInteger(p.total) || p.total < 0 || p.total > 10000 ||
              p.totalPages !== Math.ceil(p.total / 100) ||
              p.nextPage !== (page < p.totalPages ? page + 1 : null) ||
              body.data.length !== Math.min(100, Math.max(0, p.total - (page - 1) * 100)) ||
              (version && (version !== p.collectionVersion || total !== p.total))) {
            throw new OclrError('INVALID_PAGINATION');
          }
          version = p.collectionVersion;
          total = p.total;
          all.push(...body.data);
          page = p.nextPage;
        }
        if (all.length !== total) throw new OclrError('INCOMPLETE_COLLECTION');
        return all;
      } catch (error) {
        if (error.code !== 'COLLECTION_CHANGED' || attempt === 1) throw error;
      }
    }
  }

  tournaments(signal) { return this.collection('tournaments', signal); }
  players(edition, signal) { return this.collection(`${editionPath(edition)}/players`, signal); }

  async edition(edition, signal) {
    // Sequential reads respect the backend request budget and preserve all-or-error delivery.
    const path = editionPath(edition);
    const snapshot = {};
    for (const [key, suffix] of Object.entries({ overview: '', teams: '/teams', competition: '/competition', mappools: '/mappools', bracket: '/bracket' })) {
      snapshot[key] = (await this.read(`${path}${suffix}`, {}, signal)).data;
      if (key === 'overview' && snapshot.overview.overview?.kind === 'historical_archive') {
        // Published historical details have a distinct contract. Empty live
        // collections are not substitutes for the explicitly selected archive.
        snapshot.configuration = (await this.read(`${path}/configuration`, {}, signal)).data;
      }
    }
    snapshot.players = await this.players(edition, signal);
    return snapshot;
  }
}

function editionPath(edition) {
  if (typeof edition !== 'string' || edition.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edition)) {
    throw new OclrError('INVALID_EDITION');
  }
  return `tournaments/${edition}`;
}
