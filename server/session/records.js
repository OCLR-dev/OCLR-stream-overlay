// Persistent identities and compatibility projections. round.id remains the
// public legacy reference; replay links alone establish a shared Pick.
export function synchronizeRecords(state, { legacy = false } = {}) {
  state.selections ??= {};
  state.results ??= {};
  state.exRevision ??= { a: 0, b: 0 };
  state.rules = { type: state.match.stage === 'exhibition' ? 'oclr-exhibition' : 'oclr', version: 1 };
  const rounds = new Map(state.rounds.map(round => [round.id, round]));
  if (rounds.size !== state.rounds.length || state.currentRoundId && !rounds.has(state.currentRoundId)) throw new Error('INVALID_ROUND_REFERENCE');
  if (legacy) {
    const children = new Map();
    for (const round of state.rounds) if (round.replayOf) children.set(round.replayOf, (children.get(round.replayOf) || 0) + 1);
    for (const [id, count] of children) if (count > 1 && rounds.has(id)) rounds.get(id).identityUnresolved = true;
  }
  const resolving = new Set();
  const resolved = new Set();
  const identify = round => {
    if (resolved.has(round.id)) return;
    if (resolving.has(round.id)) { round.identityUnresolved = true; return; }
    resolving.add(round.id);
    const parent = round.replayOf ? rounds.get(round.replayOf) : null;
    if (parent) identify(parent);
    if (round.replayOf && (!parent || parent.identityUnresolved)) round.identityUnresolved = true;
    round.attemptId = round.id;
    round.selectionId = parent && !round.identityUnresolved ? parent.selectionId : round.selectionId || `selection:${round.id}`;
    round.resultId = `result:${round.id}`;
    resolving.delete(round.id); resolved.add(round.id);
  };
  for (const round of state.rounds) identify(round);
  if (legacy) for (const round of state.rounds) if (round.identityUnresolved) round.legacyIdentityIssue = true;
  for (const round of state.rounds) {
    const selection = state.selections[round.selectionId] ??= {
      id: round.selectionId, actionId: round.actionId ?? null, entryId: round.entryId,
      pickedBy: round.pickedBy, exTeam: round.exTeam, consumption: legacy ? 'unknown' : null,
    };
    if (round.status !== 'void') {
      selection.actionId = round.actionId ?? null;
      selection.entryId = round.entryId; selection.pickedBy = round.pickedBy; selection.exTeam = round.exTeam;
    }
    const old = state.results[round.resultId];
    const status = round.status === 'recorded' ? 'confirmed' : round.status === 'ranking' ? 'pending' : round.status === 'void' ? 'withdrawn' : 'unconfirmed';
    const result = { id: round.resultId, attemptId: round.id, selectionId: round.selectionId, status,
      winner: round.winner, source: round.resultSource ?? null, scores: round.finalScore,
      protected: !!round.autoProtected || ['manual', 'retracted', 'series-correction'].includes(round.resultSource) };
    const { revision: ignored, ...previous } = old || {};
    result.revision = old ? old.revision + (JSON.stringify(previous) !== JSON.stringify(result) ? 1 : 0) : 1;
    state.results[result.id] = result;
  }
  state.pendingResults = state.rounds.filter(round => round.status === 'ranking').map(round => round.attemptId);
  state.currentSelectionId = state.rounds.find(round => round.id === state.currentRoundId)?.selectionId ?? null;
}

export function migrateSession(input) {
  if (input.schema === 2) return input;
  if (input.schema !== 1) throw new Error('INVALID_SESSION_SCHEMA');
  const next = structuredClone(input);
  const upgrade = state => {
    synchronizeRecords(state, { legacy: true });
    state.schema = 2;
  };
  upgrade(next);
  for (const item of next.undo) upgrade(item.state);
  return next;
}

export function settleEx(state, before) {
  for (const round of state.rounds) {
    if (round.status !== 'recorded' || !round.winner || !round.exTeam || round.identityUnresolved) continue;
    const selection = state.selections[round.selectionId];
    if (selection.consumption !== null) continue;
    // A migrated recorded result has no evidence of whether an operator
    // already deducted EX. Never reconstruct that historical debit.
    if (before.rounds.find(item => item.id === round.id)?.status === 'recorded') continue;
    if (selection.exBaseline?.team !== round.exTeam || selection.exBaseline.revision !== state.exRevision[round.exTeam] || state.ex.remaining[round.exTeam] === 0) {
      // A correction after activation is authoritative at any remaining
      // value. Missing historical baselines cannot authorize another debit.
      selection.consumption = 'unknown';
      continue;
    }
    state.ex.remaining[round.exTeam]--;
    selection.consumption = { team: round.exTeam, revision: state.exRevision[round.exTeam] };
  }
}

export function refundReplayEx(state, round) {
  const selection = state.selections[round.selectionId];
  const consumption = selection.consumption;
  if (consumption && consumption !== 'unknown' && consumption.revision === state.exRevision[consumption.team]) {
    state.ex.remaining[consumption.team]++;
  }
  // Manual EX corrections remain authoritative. A future normal finish
  // contributes once against the newly prepared attempt.
  selection.consumption = null;
  selection.exBaseline = round.exTeam ? { team: round.exTeam, revision: state.exRevision[round.exTeam] } : null;
}

// Startup validation is read-only. Quarantined v1 graph defects carry explicit
// migration provenance; a new invalid v2 reference cannot opt into inference.
export function validateSessionV2(session) {
  const check = (ok, reason) => { if (!ok) throw new Error(`INVALID_SESSION_V2: ${reason}`); };
  const dictionary = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validate = state => {
    check(state.schema === 2 && Array.isArray(state.rounds) && dictionary(state.selections) && dictionary(state.results) && Array.isArray(state.pendingResults), 'record collections');
    const rounds = new Map(state.rounds.map(round => [round.id, round]));
    check(rounds.size === state.rounds.length && state.rounds.every(round => typeof round.id === 'string' && round.id), 'unique round IDs');
    check(state.currentRoundId === null || rounds.has(state.currentRoundId), 'currentRoundId');
    check(state.currentSelectionId === (rounds.get(state.currentRoundId)?.selectionId ?? null), 'currentSelectionId');
    const children = new Map();
    for (const round of state.rounds) if (round.replayOf) children.set(round.replayOf, [...(children.get(round.replayOf) || []), round]);
    const quarantined = round => round.legacyIdentityIssue === true && round.identityUnresolved === true;
    const visiting = new Set(); const visited = new Set();
    const visit = round => {
      if (visited.has(round.id)) return;
      check(!visiting.has(round.id), 'cyclic replayOf');
      visiting.add(round.id);
      if (round.replayOf) {
        const parent = rounds.get(round.replayOf);
        if (!quarantined(round)) {
          check(parent && !quarantined(parent), 'replayOf reference');
          check(children.get(parent.id).length === 1, 'ambiguous replayOf');
          check(parent.selectionId === round.selectionId, 'replay selection');
          visit(parent);
        }
      }
      visiting.delete(round.id); visited.add(round.id);
    };
    const selectionRounds = new Map(); const resultIds = new Set();
    for (const round of state.rounds) {
      visit(round);
      check(round.attemptId === round.id && typeof round.selectionId === 'string', 'attempt identity');
      const selection = state.selections[round.selectionId]; const result = state.results[round.resultId];
      check(selection?.id === round.selectionId, 'selection reference');
      check(round.resultId === `result:${round.id}` && !resultIds.has(round.resultId), 'result identity');
      resultIds.add(round.resultId);
      const status = { prepared: 'unconfirmed', playing: 'unconfirmed', ranking: 'pending', recorded: 'confirmed', void: 'withdrawn' }[round.status];
      check(status && result?.id === round.resultId && result.attemptId === round.id && result.selectionId === round.selectionId && result.status === status && result.winner === round.winner, 'result reference');
      selectionRounds.set(round.selectionId, [...(selectionRounds.get(round.selectionId) || []), round]);
    }
    check(Object.keys(state.results).length === resultIds.size, 'orphan results');
    check(Object.keys(state.selections).length === selectionRounds.size, 'orphan selections');
    for (const [id, attempts] of selectionRounds) {
      const active = attempts.filter(round => round.status !== 'void');
      check(active.length <= 1, 'multiple active attempts');
      const selection = state.selections[id];
      if (active.length) {
        const round = active[0];
        check(selection.entryId === round.entryId && selection.pickedBy === round.pickedBy && selection.exTeam === round.exTeam, 'active selection context');
      }
      const roots = attempts.filter(round => !round.replayOf);
      check(roots.length <= 1, 'ambiguous selection roots');
    }
    const pending = new Set(state.pendingResults);
    const expected = state.rounds.filter(round => round.status === 'ranking');
    check(pending.size === state.pendingResults.length && pending.size === expected.length && expected.every(round => pending.has(round.id)), 'pendingResults');
  };
  validate(session);
  check(Array.isArray(session.undo), 'undo domains');
  for (const item of session.undo) validate(item.state);
  return session;
}
