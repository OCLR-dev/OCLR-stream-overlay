<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import { mapMods, mapIcons, mapLabels, regularMods } from '../model';
const { state } = useOverlay();
const groups = [...regularMods, 'TB'].map(mod => ({
  mod,
  entries: mapMods.flatMap((value, index) => value === mod ? [{ index, slot: mapMods.slice(0, index + 1).filter(value => value === mod).length }] : [])
}));
const statusOf = (index: number) => index === 0 ? state.map : 'open';
</script>

<template>
  <div class="mappool-columns" data-mappool-columns :style="{ '--mappool-rows': groups.length }">
    <article v-for="group in groups" :key="group.mod" class="mappool-column" :data-mod="group.mod" :aria-label="`${group.mod} 示例谱面列表`">
      <header class="map-group-head"><strong>{{ group.mod }}</strong></header>
      <ol class="map-list">
        <li v-for="entry in group.entries" :key="entry.index" class="map-entry"
          :class="{ 'is-banned': statusOf(entry.index) === 'banned', 'is-picked': statusOf(entry.index) === 'picked' }"
          :data-map-index="entry.index" :data-map-state="statusOf(entry.index)" :data-mod="group.mod">
          <span class="map-thumbnail" aria-hidden="true"><span class="map-index">{{ String(entry.slot).padStart(2, '0') }}</span></span>
          <span class="map-copy">
            <span class="map-mod">{{ group.mod }}{{ entry.slot }}</span>
            <span class="map-title">谱面标题占位</span>
            <span class="map-meta">艺术家 / 难度</span>
          </span>
          <span class="map-status" :class="`state-${statusOf(entry.index)}`"><span aria-hidden="true">{{ mapIcons[statusOf(entry.index)] }}</span> {{ mapLabels[statusOf(entry.index)] }}</span>
        </li>
      </ol>
    </article>
  </div>
</template>
