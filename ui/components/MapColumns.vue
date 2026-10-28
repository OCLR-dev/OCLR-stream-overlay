<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import { mapMods, mapIcons, mapLabels } from '../model';
const { state } = useOverlay();
const groups = ['A', 'B', 'C'];
const indexOf = (group: number, row: number) => group * 6 + row - 1;
const statusOf = (index: number) => index === 0 ? state.map : 'open';
</script>

<template>
  <div class="mappool-columns" data-mappool-columns>
    <article v-for="(group, column) in groups" :key="group" class="mappool-column" :aria-label="`分组占位 ${group}，谱面列表占位`">
      <header class="map-group-head"><strong>分组占位 {{ group }}</strong></header>
      <ol class="map-list">
        <li v-for="row in 6" :key="indexOf(column, row)" class="map-entry"
          :class="{ 'is-banned': statusOf(indexOf(column, row)) === 'banned', 'is-picked': statusOf(indexOf(column, row)) === 'picked' }"
          :data-map-index="indexOf(column, row)" :data-map-state="statusOf(indexOf(column, row))" :data-mod="mapMods[indexOf(column, row)]">
          <span class="map-index" aria-hidden="true">{{ String(indexOf(column, row) + 1).padStart(2, '0') }}</span>
          <span class="map-mod" aria-hidden="true">{{ mapMods[indexOf(column, row)] }}</span>
          <span class="map-copy">
            <span class="map-title">谱面标题占位 {{ group }}-{{ String(indexOf(column, row) + 1).padStart(2, '0') }}</span>
            <span class="map-meta">艺术家 / 难度</span>
          </span>
          <span class="map-status" :class="`state-${statusOf(indexOf(column, row))}`"><span aria-hidden="true">{{ mapIcons[statusOf(indexOf(column, row))] }}</span> {{ mapLabels[statusOf(indexOf(column, row))] }}</span>
        </li>
      </ol>
    </article>
  </div>
</template>
