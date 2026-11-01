import type { Session } from './session';

// Manual broadcast marks take precedence over the automatic BP display.
// Clearing a mark explicitly keeps a card open without deleting old results.
export function poolDisplay(s: Session, entryId: string) {
  const mark = s.poolMarks?.find(item => item.entryId === entryId);
  if (mark) return { status: mark.status, team: mark.team };
  const banning = (['a', 'b'] as const).find(team => s.bans[team].includes(entryId));
  if (banning) return { status: 'banned', team: banning };
  const round = s.rounds.find(item => item.entryId === entryId && item.status !== 'void');
  return { status: round?.status === 'recorded' || round?.resultSource === 'series-correction' ? 'used' : round ? 'picked' : 'open', team: round?.pickedBy ?? null };
}

// A series correction does not identify a map winner. Only a recorded result does.
export function poolWinner(s: Session, entryId: string) {
  for (let i = s.rounds.length - 1; i >= 0; i--) {
    const round = s.rounds[i]!;
    if (round.entryId === entryId && round.status !== 'void') return round.status === 'recorded' ? round.winner : null;
  }
  return null;
}
