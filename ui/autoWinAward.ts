import type { Team } from './model';
import type { Session } from './session';

export interface AutoWinAward {
  id: string;
  team: Team;
  left: number | null;
  right: number | null;
}

// Only the automatic tosu award gets a banner. Manual wins, retractions and
// series corrections stay silent so the animation never celebrates a result
// the operator typed or a score that was later withdrawn.
export function latestAutoWinAward(session: Pick<Session, 'history' | 'rounds' | 'currentRoundId'> | null): AutoWinAward | null {
  if (!session) return null;
  const entry = [...session.history].reverse()
    .find(item => item.source === 'tosu' && item.message.includes('自动加赢图'));
  if (!entry) return null;
  const score = /最终队分\s*(\d+)\s*[:：]\s*(\d+)/.exec(entry.message);
  const left = score ? Number(score[1]) : null;
  const right = score ? Number(score[2]) : null;
  const round = session.rounds.find(item => item.id === session.currentRoundId);
  const team = round?.resultSource === 'tosu' && round.winner
    ? round.winner
    : left !== null && right !== null && left !== right
      ? left > right ? 'a' : 'b'
      : null;
  return team ? { id: entry.id, team, left, right } : null;
}

// The banner is a single line. Count code points so wide/CJK names shorten
// predictably instead of leaving the flag cramped at the edge.
export function shortenWinTeamName(name: string | null | undefined, limit = 16): string {
  const trimmed = (name || '').trim();
  const characters = Array.from(trimmed);
  return characters.length > limit ? `${characters.slice(0, limit).join('')}…` : trimmed;
}
