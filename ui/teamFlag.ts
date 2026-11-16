export interface TeamImage { id: string | null; name: string; avatarKey?: string | null }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

export function teamFlagUrl(team: TeamImage | null | undefined): string | null {
  return uuid(team?.id) && uuid(team?.avatarKey)
    ? `/api/teams/${team.id}/avatar?${new URLSearchParams({ v: team.avatarKey })}` : null;
}

export function teamMonogram(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('').toLocaleUpperCase() || '?';
}
