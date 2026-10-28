<script setup lang="ts">
import { useOverlay } from '../useOverlay';
defineProps<{ result?: boolean }>();
const { view } = useOverlay();
</script>

<template>
  <div class="map-row">
    <div class="current-map">
      <span class="map-kicker-row">
        <span class="map-kicker">{{ result ? '本图谱面' : '当前谱面' }}</span>
        <span class="map-chip" data-map-format :data-format="view.format">{{ view.formatLabel }}</span>
        <span class="map-chip" data-map-mod :data-mod="view.mod">{{ view.mod }}</span>
        <span class="map-chip map-chip--ex" data-map-ex>{{ view.exLabel }}</span>
      </span>
      <strong>{{ result ? '谱面标题占位 02' : '谱面标题占位' }}</strong>
      <span class="map-sub">艺术家 / 难度</span>
      <span class="map-rule" data-map-rule :hidden="!view.mapRule">{{ view.mapRule }}</span>
    </div>
    <div class="map-params" aria-label="谱面参数">
      <span v-for="label in ['CS', 'AR', 'OD', 'BPM', '时长']" :key="label"><b>{{ label }}</b> —</span>
    </div>
  </div>
</template>
