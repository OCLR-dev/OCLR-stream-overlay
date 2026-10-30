<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useOverlay } from '../useOverlay';
import MapArtwork from './MapArtwork.vue';
import { mapParameterDisplay, testModForCategory, type TestMapMetadata } from '../mapParameters';
defineProps<{ result?: boolean }>();
const { state, view } = useOverlay();
const mapLabel = computed(() => view.value.shared ? view.value.currentMap?.label || '—' : view.value.mod);
const mapMod = computed(() => view.value.shared ? view.value.currentMap?.mod : view.value.mod);
const metadata = ref<TestMapMetadata | null>(null);
const metadataStatus = ref('idle');
watch([() => view.value.currentMap?.beatmapId, () => view.value.parameterMode, () => view.value.currentMap?.mod], async ([id, mode, mod], _, cleanup) => {
  metadata.value = null; metadataStatus.value = 'idle';
  if (!view.value.shared || mode !== 'official-test' || !id) return;
  const controller = new AbortController(); let active = true;
  cleanup(() => { active = false; controller.abort(); });
  metadataStatus.value = 'loading';
  try {
    const response = await fetch(`/api/beatmaps/${id}/metadata/${testModForCategory(mod || null)}`, { signal: controller.signal });
    if (!response.ok) throw new Error('METADATA_UNAVAILABLE');
    const value = await response.json();
    if (active && value.beatmapId === id && value.source === 'osu-file') { metadata.value = value; metadataStatus.value = 'ready'; }
  } catch { if (active) metadataStatus.value = 'unavailable'; }
}, { immediate: true, flush: 'sync' });
const parameters = computed(() => mapParameterDisplay(view.value.currentMap?.beatmapId ?? null, view.value.parameterMode, view.value.mapParameters, metadata.value, view.value.currentMap?.mod || null));
const parameterLabel = computed(() => {
  if (view.value.parameterMode === 'official-test') return parameters.value.source === 'official-test' ? ['FM', 'TB'].includes(mapMod.value || '') ? '测试 · NM 基准' : `测试 · ${parameters.value.mod} 参数` : metadataStatus.value === 'loading' ? '测试参数读取中' : '测试参数不可用';
  return parameters.value.source === 'tosu' ? '本局参数' : '等待本局参数';
});
</script>

<template>
  <div class="map-row" :data-mod="mapMod">
    <div class="map-cover" aria-label="谱面封面"><MapArtwork :beatmap-id="view.currentMap?.beatmapId" :live="!!view.mapParameters" /><span>OCLR</span><b>{{ mapLabel }}</b></div>
    <div class="current-map">
      <span class="map-kicker-row">
        <span class="map-kicker">{{ result ? '本图谱面' : '当前谱面' }}</span>
        <span class="map-chip" data-map-format :data-format="view.format" :data-ex-team="view.ex ? state.exTeam : undefined">{{ view.formatLabel }}</span>
        <span class="map-chip" data-map-mod :data-mod="mapMod">{{ mapLabel }}</span>
        <span class="map-chip map-chip--ex" data-map-ex :data-ex-team="view.ex ? state.exTeam : undefined">{{ view.exLabel }}</span>
      </span>
      <strong>{{ view.shared ? view.currentMap?.title || view.currentMap?.label || '尚未准备谱面' : result ? '谱面标题占位 02' : '谱面标题占位' }}</strong>
      <span class="map-sub">{{ view.shared ? `${view.currentMap?.artist || '—'} / ${view.currentMap?.difficulty || '—'}` : '艺术家 / 难度' }}</span>
      <span class="map-rule" data-map-rule :hidden="!view.mapRule">{{ view.mapRule }}</span>
    </div>
    <div class="map-params" aria-label="谱面参数">
      <span class="map-parameter-source" :title="view.parameterMode === 'official-test' ? ['FM', 'TB'].includes(mapMod || '') ? '模拟测试：尚未指定自由模组，此处显示 NM 计算基准。' : '模拟测试：根据官方谱面文件和当前模组计算星级及参数，正式参数以 tosu 为准。' : '读取与本局谱面、房间匹配的 tosu 参数。'">{{ parameterLabel }}</span>
      <span v-for="param in parameters.rows" :key="param.label" :data-map-param="param.label"><b>{{ param.label }}</b> {{ param.value }}</span>
    </div>
    <div class="map-slot"><span>{{ result ? 'MAP RESULT' : 'NOW PLAYING' }}</span><b :title="mapLabel">{{ mapLabel }}</b><span>{{ view.formatLabel }} · {{ view.modeLabel }}</span></div>
  </div>
</template>
