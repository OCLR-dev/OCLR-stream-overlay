import type { BeatmapStats, PoolEntry } from './session';

// Both outputs use this presentation contract; competition state stays in its adapter.
export interface MapInfoSource {
  shared: boolean;
  emptyTitle?: string;
  metadataEnabled?: boolean;
  currentMap: PoolEntry | null;
  mod?: string;
  parameterMode: 'tosu' | 'official-test';
  mapParameters: { id: number | null; stats: BeatmapStats | null; time: { lastObject: number | null } } | null;
  pickTeam?: string | null;
  ex?: boolean;
  exTeam?: string;
  exLabel?: string;
  mapRule?: string | null;
}
