<script setup lang="ts">
import { computed } from 'vue';
import { useOverlay } from '../useOverlay';
defineProps<{ result?: boolean }>();
const { view } = useOverlay();
const numeric = (value: number | null | undefined, digits = 2) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(Number(value.toFixed(digits))) : '—';
const duration = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  const seconds = Math.floor(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const parameters = computed(() => {
  const map = view.value.mapParameters;
  return [
    { label: '★', value: numeric(map?.stats?.stars.total) },
    { label: 'CS', value: numeric(map?.stats?.cs.converted) },
    { label: 'AR', value: numeric(map?.stats?.ar.converted) },
    { label: 'OD', value: numeric(map?.stats?.od.converted) },
    { label: 'BPM', value: numeric(map?.stats?.bpm.common) },
    { label: '时长', value: duration(map?.time.lastObject) },
  ];
});
</script>

<template>
  <div class="map-row">
    <div class="map-cover" aria-label="谱面封面占位"><span>OCLR</span><b>{{ view.mod }}</b></div>
    <div class="current-map">
      <span class="map-kicker-row">
        <span class="map-kicker">{{ result ? '本图谱面' : '当前谱面' }}</span>
        <span class="map-chip" data-map-format :data-format="view.format">{{ view.formatLabel }}</span>
        <span class="map-chip" data-map-mod :data-mod="view.mod">{{ view.mod }}</span>
        <span class="map-chip map-chip--ex" data-map-ex>{{ view.exLabel }}</span>
      </span>
      <strong>{{ view.shared ? view.currentMap?.title || view.currentMap?.label || '尚未准备谱面' : result ? '谱面标题占位 02' : '谱面标题占位' }}</strong>
      <span class="map-sub">{{ view.shared ? `${view.currentMap?.artist || '—'} / ${view.currentMap?.difficulty || '—'}` : '艺术家 / 难度' }}</span>
      <span class="map-rule" data-map-rule :hidden="!view.mapRule">{{ view.mapRule }}</span>
    </div>
    <div class="map-params" aria-label="谱面参数">
      <span v-for="param in parameters" :key="param.label" :data-map-param="param.label"><b>{{ param.label }}</b> {{ param.value }}</span>
    </div>
    <div class="map-slot"><span>{{ result ? 'MAP RESULT' : 'NOW PLAYING' }}</span><b>{{ view.mod }}</b><span>{{ view.formatLabel }} · {{ view.modeLabel }}</span></div>
  </div>
</template>
