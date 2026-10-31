import type { Envelope } from './session';

export interface RankingScoreHold {
  key: string;
  mapId: number;
  scores: { left: number; right: number };
}
const complete = (score: { left: number | null | undefined; right: number | null | undefined }): score is { left: number; right: number } =>
  [score.left, score.right].every(value => Number.isSafeInteger(value) && value! >= 0);

// Display memory only: it cannot award a win or change a saved result.
export function retainRankingScores(envelope: Envelope | null | undefined, connection: string | undefined, scene: string, previous: RankingScoreHold | null): RankingScoreHold | null {
  const session = envelope?.session;
  if (!session || !['playing', 'map-result'].includes(scene) || session.incident) return null;
  const source = envelope.live.tosu;
  const room = source.data?.tourney;
  const round = session.rounds.find(value => value.id === session.currentRoundId);
  const entry = session.pool.find(value => value.id === round?.entryId);
  if (room?.ipcState === 3 || round && !['ranking', 'recorded'].includes(round.status) && room?.ipcState !== 4) return null;
  const mapId = entry?.beatmapId || source.data?.beatmap.id || previous?.mapId;
  if (!mapId) return null;
  const key = JSON.stringify([session.id, round?.id || null, mapId, session.auto.left, session.auto.right]);
  let scores: RankingScoreHold['scores'] | null = null;
  if (round?.finalScore) {
    const saved = { left: round.finalScore.a, right: round.finalScore.b };
    if (complete(saved)) scores = saved;
  }
  if (!scores && connection === 'synced' && source.status === 'live' && room?.ipcState === 4 &&
    room.scoreVisible !== false && source.data?.beatmap.id === mapId && complete(room.totalScore)) scores = room.totalScore;
  if (scores) {
    if (previous?.key === key && previous.scores.left === scores.left && previous.scores.right === scores.right) return previous;
    return { key, mapId, scores: { ...scores } };
  }
  return previous?.key === key ? previous : null;
}
