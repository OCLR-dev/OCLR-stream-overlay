import { normalizePool, requireValue } from './model.js';

// An explicit import copies published records into a local match. Periodic reads
// update source health/catalogue only; they never overwrite BP or manual results.
export function catalogue(source) {
  const data = source.status === 'ready' ? source.data : null;
  if (data?.overview?.overview?.kind === 'historical_archive') {
    const archive = data.configuration?.edition?.archive;
    requireValue(archive && archive.editionSlug === data.overview.slug, '历史资料缺失或赛季不一致');
    const warnings = [];
    const teams = archive.teams.map(t => ({ id: t.id, name: t.name,
      roster: archive.players.filter(p => p.teamId === t.id && ['captain', 'player'].includes(p.role)).map(p => ({ name: p.username, osuId: p.osuId })) }));
    return {
      kind: 'historical_archive', capturedOn: archive.capturedOn, warnings, teams,
      pools: archive.pools.map(p => {
        const valid = p.maps.filter(m => Number.isSafeInteger(m.beatmapId) && m.beatmapId > 0 && /^(NM|HD|HR|DT|FM|TB)\d+$/.test(m.slot));
        if (valid.length !== p.maps.length) warnings.push(`${p.name}：${p.maps.length - valid.length} 个条目缺失谱面 ID 或使用未支持的 mod，未导入`);
        return { id: p.id, name: p.name, entries: normalizePool(valid.map(m => ({ id: `${p.id}:${m.slot}`, label: m.slot,
          mod: m.slot.match(/^[A-Z]+/)[0], beatmapId: m.beatmapId, setId: m.setId, title: m.title || '', artist: '', difficulty: '' }))) };
      }),
      fixtures: archive.matches.map(f => ({ id: f.id, label: f.label, roundName: f.stage,
        home: { team: teams.find(t => t.id === f.teamA) || null }, away: { team: teams.find(t => t.id === f.teamB) || null },
        pool: f.poolId ? { id: f.poolId } : null, referenceScore: f.score })),
    };
  }
  return {
    kind: 'published', capturedOn: null, warnings: [],
    teams: data?.teams?.map(t => ({ id: t.id, name: t.name, roster: t.members?.map(p => ({ name: p.username, osuId: p.osuId })) || [] })) || [],
    pools: data?.mappools?.map(p => ({ id: p.id, name: p.name, entries: normalizePool(p.entries.map(e => ({
      id: e.id, beatmapId: e.beatmapId, setId: e.metadata?.setId, mod: e.category, label: `${e.category}${e.position}`,
      title: e.metadata?.title || '', artist: e.metadata?.artist || '', difficulty: e.metadata?.difficulty || '',
    }))) })) || [],
    fixtures: data?.competition?.fixtures?.map(f => ({ id: f.id, label: f.label, roundName: f.roundName,
      home: f.home, away: f.away, pool: f.pool })) || [],
  };
}

export function attachBroadcast(store, data) {
  let lastFrame = null;
  let lastStatus = null;
  let lastOclr = null;
  store.catalog = { edition: null, teams: [], pools: [], fixtures: [] };
  store.loadEdition = async edition => {
    await data.selectEdition(edition);
    requireValue(data.state.oclr.status === 'ready' && store.live.oclr.status === 'ready', 'OCLR 读取失败，请查看来源状态');
    return store.snapshot();
  };
  store.importMatch = async command => {
    const p = command.payload;
    requireValue(data.state.oclr.status === 'ready' && store.catalog.edition === p.edition, '请先读取当前赛季资料');
    const catalog = store.catalog;
    const a = catalog.teams.find(t => t.id === p.leftTeamId);
    const b = catalog.teams.find(t => t.id === p.rightTeamId);
    const pool = catalog.pools.find(t => t.id === p.poolId);
    const fixture = p.fixtureId ? catalog.fixtures.find(f => f.id === p.fixtureId) : null;
    requireValue(a && b && a.id !== b.id && pool && (!p.fixtureId || fixture), '请明确选择本场队伍、场次和图池');
    return store.command({ ...command, type: 'update-setup', payload: {
      title: p.title, edition: p.edition, fixtureId: fixture?.id || null, poolId: pool.id, provenance: catalog.kind === 'historical_archive' ? 'oclr-archive' : 'oclr',
      teams: { a, b }, pool: pool.entries, stage: p.stage, mode: p.mode, source: p.source,
    } });
  };
  const unsubscribe = data.subscribe(snapshot => {
    const tosu = snapshot.tosu;
    if (tosu.status !== lastStatus) { lastStatus = tosu.status; store.sourceStatus(tosu.status); }
    if (tosu.status === 'live' && tosu.frameSeq && tosu.frameSeq !== lastFrame) {
      lastFrame = tosu.frameSeq;
      void store.frame(tosu.data).catch(() => { store.live.note = '会话自动更新未保存，请检查本机存储'; store.emit(); });
    }
    const oclrKey = `${snapshot.oclr.status}:${snapshot.oclr.updatedAt}:${snapshot.oclr.error}:${snapshot.selection.edition}`;
    if (oclrKey !== lastOclr) {
      lastOclr = oclrKey;
      const { status, updatedAt, error } = snapshot.oclr;
      store.live.oclr = { status, updatedAt, error };
      try {
        // Keep selector labels stable during a same-edition refresh. Import stays
        // disabled until ready; authorization/error still clears the catalogue.
        if (status !== 'loading' || store.catalog.edition !== snapshot.selection.edition) {
          store.catalog = { edition: snapshot.selection.edition, ...catalogue(snapshot.oclr) };
        }
      }
      catch { store.catalog = { edition: snapshot.selection.edition, teams: [], pools: [], fixtures: [] }; store.live.oclr = { status: 'error', updatedAt: null, error: 'INVALID_CATALOGUE' }; }
      store.emit();
    }
  });
  data.start();
  return () => { unsubscribe(); data.stop(); };
}
