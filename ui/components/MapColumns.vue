<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { vEmphasize } from '../motion';
import { useOverlay } from '../useOverlay';
import { modColorStyle } from '../modColors';
import MapArtwork from './MapArtwork.vue';
import { mapFileMetadata } from '../mapMetadata';
import type { PoolEntry } from '../session';
const { view, state, motionScope, motionReady } = useOverlay();
const maxColumns = 6;
// Large-card layout starts at the last two column steps, so it follows the
// layout cap instead of a literal column number.
const largeCardFrom = Math.max(2, maxColumns - 1);
const groups = computed(() => ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'].map(mod => ({
  mod, entries: view.value.pool.filter(entry => entry.mod === mod)
})).filter(group => group.entries.length).map(group => ({ ...group, rows: Math.ceil(group.entries.length / maxColumns) })));
// Use the widest cards that preserve the six-column layout's row count.
const columns = computed(() => {
  const minimumRows = groups.value.reduce((sum, group) => sum + group.rows, 0);
  return Array.from({ length: maxColumns }, (_, index) => index + 1).find(count =>
    groups.value.reduce((sum, group) => sum + Math.ceil(group.entries.length / count), 0) === minimumRows) || maxColumns;
});
const rows = computed(() => Math.max(1, groups.value.reduce((sum, group) => sum + group.rows, 0)));
const cardNumber = (entry: { label: string }, index: number) => entry.label.match(/(\d+)$/)?.[1] || String(index + 1);
const resolvedDifficulty = reactive<Record<number, string>>({});
const requested = new Set<number>();
const trimmed = (value: string | null | undefined) => typeof value === 'string' ? value.trim() : '';
const artistFor = (entry: PoolEntry) => trimmed(entry.artist);
const difficultyFor = (entry: PoolEntry) => trimmed(entry.difficulty) || resolvedDifficulty[entry.beatmapId] || '';
const loadDifficulty = (entry: PoolEntry) => {
  if (trimmed(entry.difficulty) || entry.beatmapId <= 0 || requested.has(entry.beatmapId)) return;
  requested.add(entry.beatmapId);
  void mapFileMetadata(entry.beatmapId).then(metadata => {
    if (metadata?.difficulty) resolvedDifficulty[entry.beatmapId] = metadata.difficulty;
    else requested.delete(entry.beatmapId);
  });
};
watch(groups, next => {
  for (const group of next) for (const entry of group.entries) loadDifficulty(entry);
}, { immediate: true });
</script>

<template>
  <div class="mappool-columns" :class="{ 'mappool-columns--dense': columns === maxColumns, 'mappool-columns--stacked': rows > 6, 'mappool-columns--large': columns >= largeCardFrom && rows <= 6 }" data-mappool-columns :style="{ '--mappool-rows': rows, '--pool-columns': columns }">
    <p v-if="!groups.length" class="pool-empty">尚未加载本场图池 · 请在控制台设置</p>
    <article v-for="group in groups" :key="group.mod" class="mappool-column" :data-mod="group.mod" :aria-label="`${group.mod} 谱面列表`" :style="[modColorStyle(group.mod), { gridRow: `span ${group.rows}`, '--group-rows': group.rows }]">
      <header class="map-group-head"><strong>{{ group.mod }}</strong></header>
      <ol class="map-list">
        <li v-for="(entry, index) in group.entries" :key="entry.id" class="map-entry"
          :class="{ 'is-banned': entry.status === 'banned', 'is-picked': entry.status === 'picked' || entry.status === 'used', 'has-winner': !!entry.winnerTeam }"
          :data-map-index="entry.id" :data-map-state="entry.status" :data-team="entry.actionTeam" :data-mod="group.mod" :style="{ '--map-number-length': String(cardNumber(entry, index).length) }">
          <span class="map-confirmation" aria-hidden="true" v-emphasize="{ value: [entry.status, entry.actionTeam], scope: motionScope, enabled: motionReady, visible: state.scene === 'mappool', when: entry.status === 'banned' || entry.status === 'picked', kind: 'confirm' }"><b>{{ entry.status === 'banned' ? 'BAN' : group.mod === 'TB' ? 'TB' : 'PICK' }}</b><span>{{ entry.actionTeam ? view.names[entry.actionTeam] : '已确认' }}</span></span>
          <svg v-if="entry.status === 'banned'" class="map-ban-slash" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="0" x2="100" y2="100" vector-effect="non-scaling-stroke" /></svg>
          <MapArtwork class="map-base-artwork" :beatmap-id="entry.beatmapId" />
          <span class="map-entry-media"><MapArtwork :beatmap-id="entry.beatmapId" :live="view.mapParameters?.id === entry.beatmapId" variant="list" /></span>
          <span class="map-copy"><span class="map-title" :title="entry.title || '标题未知'">{{ entry.title || '标题未知' }}</span><span v-if="artistFor(entry) || difficultyFor(entry)" class="map-meta"><template v-if="artistFor(entry)"><span class="map-meta-artist">{{ artistFor(entry) }}</span><span class="map-meta-sep"> / </span></template><span class="map-meta-difficulty">{{ difficultyFor(entry) || '—' }}</span></span></span>
          <span class="map-index" :title="entry.label">#{{ cardNumber(entry, index) }}</span>
          <span v-if="entry.status === 'banned' || entry.winnerTeam || (group.mod === 'TB' && entry.status !== 'open')" class="map-status" :class="{ 'state-winner': !!entry.winnerTeam }" :data-winner="entry.winnerTeam" :title="entry.statusLabel" :aria-label="entry.statusLabel">{{ entry.winnerTeam ? entry.winnerTeam === 'a' ? '红队 胜' : '蓝队 胜' : group.mod === 'TB' ? '决胜图' : `${entry.actionTeam === 'a' ? '红 ' : entry.actionTeam === 'b' ? '蓝 ' : ''}Ban` }}</span>
        </li>
      </ol>
    </article>
  </div>
</template>
