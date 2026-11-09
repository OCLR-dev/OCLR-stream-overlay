<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { vEmphasize } from '../motion';
import { useOverlay } from '../useOverlay';
import { modColorStyle } from '../modColors';
import MapArtwork from './MapArtwork.vue';
import { MAP_METADATA_RETRY_MS, mapFileMetadata } from '../mapMetadata';
import { mapStarDisplay } from '../mapStats';
import { testModForCategory, type TestMapMetadata } from '../mapParameters';
import type { PoolEntry } from '../session';
const { view, state, motionScope, motionReady } = useOverlay();
const maxColumns = 6;
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
const resolvedMetadata = reactive<Record<string, TestMapMetadata>>({});
const requested = new Set<string>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
let disposed = false;
const trimmed = (value: string | null | undefined) => typeof value === 'string' ? value.trim() : '';
const artistFor = (entry: PoolEntry) => trimmed(entry.artist);
const metadataKey = (entry: PoolEntry) => `${entry.beatmapId}:${testModForCategory(entry.mod)}`;
const metadataFor = (entry: PoolEntry) => resolvedMetadata[metadataKey(entry)] || null;
const difficultyFor = (entry: PoolEntry) => trimmed(entry.difficulty) || metadataFor(entry)?.difficulty || '';
const starFor = (entry: PoolEntry) => mapStarDisplay(metadataFor(entry), testModForCategory(entry.mod));
// Picked maps keep a persistent label until a winner is recorded. Once the
// round has a red/blue winner, the winner label takes over instead.
type PoolCardState = Pick<PoolEntry, 'mod'> & { status: string; actionTeam: 'a' | 'b' | null; winnerTeam: 'a' | 'b' | null; current: boolean };
const picked = (entry: PoolCardState) => entry.mod !== 'TB' && !entry.winnerTeam && (entry.status === 'picked' || entry.status === 'used');
// Only the current round keeps the animated selection marquee. Older prepared
// picks remain labelled "蓝队选择/红队选择" without looking like the active pick.
const chosen = (entry: PoolCardState) => picked(entry) && entry.current;
const stateText = (entry: PoolCardState) => {
  if (entry.winnerTeam) return entry.winnerTeam === 'a' ? '红队胜利' : '蓝队胜利';
  if (entry.mod === 'TB') return '决胜图';
  const team = entry.actionTeam === 'a' ? '红队' : entry.actionTeam === 'b' ? '蓝队' : '';
  return entry.status === 'banned' ? `${team}禁用` : team ? `${team}选择` : '已选择';
};
const loadMetadata = (entry: PoolEntry) => {
  const key = metadataKey(entry);
  // Every card shows the mod-specific star rating, so load metadata even when
  // the streaming session already supplied the difficulty name.
  if (entry.beatmapId <= 0 || requested.has(key)) return;
  requested.add(key);
  void mapFileMetadata(entry.beatmapId, testModForCategory(entry.mod)).then(metadata => {
    if (disposed) return;
    if (metadata) resolvedMetadata[key] = metadata;
    else retryTimers.set(key, setTimeout(() => {
      retryTimers.delete(key);
      requested.delete(key);
      const current = view.value.pool.find(item => metadataKey(item) === key);
      if (current) loadMetadata(current);
    }, MAP_METADATA_RETRY_MS));
  });
};
watch(groups, next => {
  for (const group of next) for (const entry of group.entries) loadMetadata(entry);
}, { immediate: true });

// A card's absolute star sits over the artwork. Once the card is too short for
// the star and the title to clear each other, drop the star beside the
// difficulty line and reserve the matching left gutter for it.
const compactHeight = 96;
// Below this height the top-right state chip and the #N badge would crowd or
// overlap, so both shrink while keeping the same 8px edge inset between them.
const tightHeight = 80;
// Tall cards have room for the higher-resolution official artwork; short cards
// (compact or not) use the lighter cover image so dense pools stay cheap.
const fullsizeHeight = 120;
const columnsRoot = ref<HTMLElement | null>(null);
const compactCards = reactive(new Set<string>());
const tightCards = reactive(new Set<string>());
const fullsizeCards = reactive(new Set<string>());
let cardObserver: ResizeObserver | undefined;
const measureCard = (element: HTMLElement) => {
  const id = element.dataset.mapIndex;
  if (!id) return;
  if (element.offsetHeight < compactHeight) compactCards.add(id);
  else compactCards.delete(id);
  if (element.offsetHeight < tightHeight) tightCards.add(id);
  else tightCards.delete(id);
  if (element.offsetHeight > fullsizeHeight) fullsizeCards.add(id);
  else fullsizeCards.delete(id);
};
// The compact card puts the star beside the difficulty line, so the text has to
// clear the chip's real rendered width (which changes with the star value and
// font size) rather than a fixed gutter.
const measureStar = (element: HTMLElement) => {
  const card = element.closest<HTMLElement>('[data-map-index]');
  if (!card) return;
  card.style.setProperty('--star-chip-width', `${element.offsetWidth}px`);
};
const observeCards = () => {
  cardObserver?.disconnect();
  const root = columnsRoot.value;
  if (!root) return;
  for (const element of root.querySelectorAll<HTMLElement>('[data-map-index]')) {
    measureCard(element);
    cardObserver?.observe(element);
    const star = element.querySelector<HTMLElement>('.map-star');
    if (star) {
      measureStar(star);
      cardObserver?.observe(star);
    }
  }
};
onMounted(() => {
  cardObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const target = entry.target as HTMLElement;
      if (target.classList.contains('map-star')) measureStar(target);
      else measureCard(target);
    }
  });
  void nextTick(observeCards);
});
watch(groups, () => { void nextTick(observeCards); });
onBeforeUnmount(() => {
  disposed = true;
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  cardObserver?.disconnect(); compactCards.clear(); tightCards.clear();
});
</script>

<template>
  <div ref="columnsRoot" class="mappool-columns mappool-columns--large" data-mappool-columns :style="{ '--mappool-rows': rows, '--pool-columns': columns }">
    <p v-if="!groups.length" class="pool-empty">尚未加载本场图池 · 请在控制台设置</p>
    <article v-for="group in groups" :key="group.mod" class="mappool-column" :data-mod="group.mod" :aria-label="`${group.mod} 谱面列表`" :style="[modColorStyle(group.mod), { gridRow: `span ${group.rows}`, '--group-rows': group.rows }]">
      <header class="map-group-head"><strong>{{ group.mod }}</strong></header>
      <ol class="map-list">
        <li v-for="(entry, index) in group.entries" :key="entry.id" class="map-entry"
          :class="{ 'is-banned': entry.status === 'banned', 'is-picked': entry.status === 'picked' || entry.status === 'used', 'has-winner': !!entry.winnerTeam }"
          :data-has-state="entry.status === 'banned' || !!entry.winnerTeam || picked(entry) ? 'true' : undefined" :data-winner="entry.winnerTeam || undefined" :data-map-index="entry.id" :data-compact="compactCards.has(entry.id) ? 'true' : undefined" :data-tight="tightCards.has(entry.id) ? 'true' : undefined" :data-star="entry.beatmapId > 0 ? 'true' : undefined" :data-map-state="entry.status" :data-team="entry.actionTeam" :data-mod="group.mod" :style="{ '--map-number-length': String(cardNumber(entry, index).length) }">
          <span class="map-confirmation" aria-hidden="true" v-emphasize="{ value: [entry.status, entry.actionTeam], scope: motionScope, enabled: motionReady, visible: state.scene === 'mappool', when: entry.status === 'banned' || entry.status === 'picked', kind: 'confirm' }"><b>{{ entry.status === 'banned' ? 'BAN' : group.mod === 'TB' ? 'TB' : 'PICK' }}</b><span>{{ entry.actionTeam ? view.names[entry.actionTeam] : '已确认' }}</span></span>
          <span v-if="entry.status === 'banned'" class="map-state-veil" aria-hidden="true"></span>
          <span v-if="entry.status === 'banned' || entry.winnerTeam || (group.mod === 'TB' && entry.status !== 'open') || picked(entry)" class="map-state-label" :class="{ 'map-state-label--corner': entry.status === 'banned' || !!entry.winnerTeam || picked(entry), 'map-state-label--winner': !!entry.winnerTeam }">
            <span class="map-status" :data-winner="entry.winnerTeam" :title="entry.statusLabel" :aria-label="entry.statusLabel">{{ stateText(entry) }}</span>
          </span>
          <svg v-if="chosen(entry)" class="map-turn-marquee" aria-hidden="true" focusable="false">
            <rect x="0" y="0" width="100%" height="100%" rx="4" pathLength="100" />
          </svg>
          <MapArtwork class="map-base-artwork" :beatmap-id="entry.beatmapId" />
          <span class="map-entry-media"><MapArtwork :beatmap-id="entry.beatmapId" :variant="fullsizeCards.has(entry.id) ? 'fullsize' : 'cover'" /></span>
          <span v-if="entry.beatmapId > 0" class="map-stat map-star" :style="{ '--stat-color': starFor(entry).color || undefined, '--stat-ink': starFor(entry).ink }" :title="`星数 ${starFor(entry).value}`" :aria-label="`星数 ${starFor(entry).value}`"><span class="map-stat-label">★</span><span class="map-stat-value">{{ starFor(entry).value }}</span></span>
          <span class="map-copy"><span class="map-title" :title="entry.title || '标题未知'">{{ entry.title || '标题未知' }}</span><span v-if="artistFor(entry) || difficultyFor(entry)" class="map-meta"><template v-if="artistFor(entry)"><span class="map-meta-artist">{{ artistFor(entry) }}</span><span class="map-meta-sep"> / </span></template><span class="map-meta-difficulty">{{ difficultyFor(entry) || '—' }}</span></span></span>
          <span class="map-index" :title="entry.label">#{{ cardNumber(entry, index) }}</span>
        </li>
      </ol>
    </article>
  </div>
</template>
