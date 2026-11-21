<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { MapInfoSource } from '../mapInfo';
import MapArtwork from './MapArtwork.vue';
import ScrollingText from './ScrollingText.vue';
import { mapParameterDisplay, testModForCategory, type TestMapMetadata } from '../mapParameters';
import { starRatingDisplay, starRatingRangeDisplay } from '../mapStats';
import { MAP_METADATA_RETRY_MS, mapFileMetadata } from '../mapMetadata';
import { modColor, modColorStyle } from '../modColors';
const props = defineProps<{ source: MapInfoSource }>();
const view = computed(() => props.source);
const state = computed(() => ({ exTeam: props.source.exTeam || 'none' }));
const mapLabel = computed(() => view.value.shared ? view.value.currentMap?.label || '—' : view.value.mod);
const mapMod = computed(() => view.value.shared ? view.value.currentMap?.mod : view.value.mod);
const metadata = ref<TestMapMetadata | null>(null);
const mapTitle = computed(() => {
  if (!view.value.shared) return '谱面标题占位';
  const map = view.value.currentMap;
  return map?.title || metadata.value?.title || map?.label || view.value.emptyTitle || '尚未准备谱面';
});
const mapSubtitle = computed(() => {
  if (!view.value.shared) return '难度';
  const map = view.value.currentMap;
  const difficulty = map?.difficulty?.trim() || metadata.value?.difficulty?.trim();
  if (difficulty && mapTitle.value.includes(`[${difficulty}]`)) return '';
  return difficulty || map?.artist || metadata.value?.artist || '—';
});
watch([() => view.value.currentMap?.beatmapId, () => view.value.currentMap?.mod, () => view.value.metadataEnabled], ([id, mod, enabled], _, cleanup) => {
  metadata.value = null;
  if (!view.value.shared || !id || enabled === false) return;
  let active = true;
  let retry: ReturnType<typeof setTimeout> | undefined;
  cleanup(() => { active = false; clearTimeout(retry); });
  const load = async () => {
    const value = await mapFileMetadata(id, testModForCategory(mod || null));
    if (!active) return;
    metadata.value = value;
    if (!value) retry = setTimeout(() => { void load(); }, MAP_METADATA_RETRY_MS);
  };
  void load();
}, { immediate: true, flush: 'sync' });
const parameters = computed(() => mapParameterDisplay(view.value.currentMap?.beatmapId ?? null, view.value.parameterMode, view.value.mapParameters, metadata.value, view.value.currentMap?.mod || null));
const star = computed(() => parameters.value.rangeMode
  ? starRatingRangeDisplay(view.value.mapParameters?.stats?.ranges?.stars) : starRatingDisplay(parameters.value.stars));
// Black ink needs no shadow: it would only muddy the text. The star and the
// pool-position block both inherit their ink from the middleware colours.
const isBlackInk = (color: string | null | undefined) => {
  const hex = (color || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 48;
};
const starShadow = computed(() => isBlackInk(star.value.ink) ? 'none' : '0 2px 5px #000000b3');
const slotShadow = computed(() => isBlackInk(modColor(mapMod.value).color) ? 'none' : '0 2px 5px #000000b3');
// The big star block already owns the rating, so the parameter row omits ★.
const parameterRows = computed(() => parameters.value.rows.filter(row => row.label !== '★'));
const compactParameters = computed(() => parameters.value.rangeMode && parameterRows.value.reduce((length, row) => length + row.label.length + row.value.length, 0) > 64);
</script>

<template>
  <div class="map-row" :data-mod="mapMod" :data-pick="view.pickTeam || 'none'" :style="modColorStyle(mapMod)">
    <MapArtwork :beatmap-id="view.currentMap?.beatmapId" :source-url="view.artworkUrl" :live="!!view.mapParameters" />
    <div class="map-star-slot" :data-range="star.value.includes('–') || undefined" :style="{ '--star-bg': star.color || undefined, '--star-ink': star.ink, '--slot-shadow': starShadow }" :title="`星数 ${star.value}`" :aria-label="`星数 ${star.value}`">
      <span class="map-star-caption" aria-hidden="true">星数 ★</span>
      <b>{{ star.value }}</b>
    </div>
    <div class="current-map">
      <strong :title="mapTitle">{{ mapTitle }}</strong>
      <div v-if="mapSubtitle" class="map-subline">
        <span class="map-sub" :title="mapSubtitle">{{ mapSubtitle }}</span>
      </div>
    </div>
    <div class="map-params" :data-source="parameters.source" :data-range="parameters.rangeMode" :data-compact="compactParameters" :aria-label="parameters.rangeMode ? '谱面参数：各选手实际数值范围，相同值合并显示' : '谱面参数'">
      <span v-for="param in parameterRows" :key="param.label" :data-map-param="param.label"><b>{{ param.label }}</b> {{ param.value }}</span>
      <div v-if="view.ex || view.mapRule" class="map-status-slot">
        <span v-if="view.ex" class="map-chip" data-map-ex data-format="ex" :data-ex-team="state.exTeam" :title="view.exLabel" :aria-label="view.exLabel">{{ view.exLabel }}</span>
        <ScrollingText v-if="view.mapRule" class="map-rule" data-map-rule :text="view.mapRule" :title="view.mapRule" />
      </div>
    </div>
    <div class="map-slot" :style="{ '--slot-shadow': slotShadow }">
      <span>所属图池位置</span>
      <b :title="mapLabel">{{ mapLabel }}</b>
    </div>
  </div>
</template>
