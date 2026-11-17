<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useShowcase } from '../showcase';
import { useCanvasFit } from '../useOverlay';
import { MAP_METADATA_RETRY_MS, mapFileMetadata } from '../mapMetadata';
import { testModForCategory, type TestMapMetadata } from '../mapParameters';
import ShowcaseCover from './ShowcaseCover.vue';
import '../showcase.css';

// Read-only output above OBS's replay and chat sources. Playback decisions and
// completed-map progress come from the server, including across page reloads.
const { snapshot, connection } = useShowcase();
const { stage, scale } = useCanvasFit();
const covered = computed(() => connection.value !== 'synced' || snapshot.value?.transition?.covered !== false);
const metadata = ref<TestMapMetadata | null>(null);
const nextMap = computed(() => {
  const s = snapshot.value;
  return connection.value === 'synced' && s?.matchedId && s.currentMap && String(s.currentMap.beatmapId) !== s.transition?.lastMap ? s.currentMap : null;
});
watch([() => nextMap.value?.beatmapId, () => nextMap.value?.mod, () => !!snapshot.value?.websitePool], ([id, mod, website], _, cleanup) => {
  metadata.value = null;
  if (!id || website) return;
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
}, { immediate: true });
const next = computed(() => nextMap.value ? { ...nextMap.value,
  title: nextMap.value.title || metadata.value?.title || '',
  artist: nextMap.value.artist || metadata.value?.artist || '',
  difficulty: nextMap.value.difficulty || metadata.value?.difficulty || '' } : null);
const artwork = computed(() => !next.value ? null : snapshot.value?.websiteArtwork !== undefined
  ? snapshot.value.websiteArtwork : `/api/beatmaps/${next.value.beatmapId}/background`);
onMounted(() => { document.title = 'OCLR · Showcase 过场'; document.body.classList.add('is-showcase-cover'); });
onUnmounted(() => document.body.classList.remove('is-showcase-cover'));
</script>

<template>
  <main ref="stage" class="showcase-cover-output" aria-label="Showcase 过场输出">
    <div class="broadcast-canvas" :style="{ transform: `scale(${scale})` }" data-showcase-cover-output>
      <ShowcaseCover :covered="covered" :instant="connection !== 'synced' || snapshot?.transition?.instant !== false"
        :next="next" :artwork-url="artwork" :pool="snapshot?.pool || []" :shown="snapshot?.transition?.shown || []"
        :stage-label="snapshot?.stageLabel || ''" />
    </div>
  </main>
</template>

<style>
body.is-showcase-cover { background: transparent; }
.showcase-cover-output { position: fixed; inset: 0; overflow: hidden; background: transparent; }
.showcase-cover-output .broadcast-canvas { background: transparent; }
</style>
