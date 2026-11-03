export type RosterInputPlayer = { name: string | null; osuId: number | null };

const MAX_ROSTER = 20;
const UNKNOWN_NAME = '未知';

// One player per line: "username,uid". A bare number is a UID and becomes the
// display name; a bare name has no UID. Both missing stays visible as unknown.
export function parseRosterInput(text: string): RosterInputPlayer[] {
  const players: RosterInputPlayer[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? '').trim().replaceAll('，', ',');
    if (!line) continue;
    const comma = line.indexOf(',');
    let rawName = line;
    let rawId = '';
    if (comma >= 0) {
      if (line.indexOf(',', comma + 1) >= 0) throw new Error(`第 ${index + 1} 行格式应为“用户名,UID”`);
      rawName = line.slice(0, comma).trim();
      rawId = line.slice(comma + 1).trim();
    } else if (/^\d+$/.test(line)) {
      rawName = '';
      rawId = line;
    }
    let osuId: number | null = null;
    if (rawId) {
      const value = Number(rawId);
      if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(value)) throw new Error(`第 ${index + 1} 行 UID 无效`);
      osuId = value;
    }
    players.push({ name: rawName || (osuId != null ? String(osuId) : UNKNOWN_NAME), osuId });
    if (players.length > MAX_ROSTER) throw new Error(`名单最多 ${MAX_ROSTER} 人`);
  }
  return players;
}

export function formatRosterInput(players: readonly RosterInputPlayer[]): string {
  return players.map(player => {
    const name = player.name?.trim() || (player.osuId != null ? String(player.osuId) : UNKNOWN_NAME);
    return player.osuId != null && name !== String(player.osuId) ? `${name},${player.osuId}` : name;
  }).join('\n');
}
