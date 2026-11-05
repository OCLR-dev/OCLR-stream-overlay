<script setup lang="ts">
import { computed, ref, watch } from 'vue';
const props = defineProps<{ beatmapId?: number | null; live?: boolean; variant?: 'cover' | 'list' | 'fullsize' }>();
const loaded = ref(false);
const failed = ref(false);
const coverFallback = ref(false);
const kind = computed(() => props.live ? 'background' : coverFallback.value ? 'cover' : props.variant || 'cover');
const src = computed(() => Number.isSafeInteger(props.beatmapId) && props.beatmapId! > 0 ? `/api/beatmaps/${props.beatmapId}/${kind.value}` : null);
// The artwork variant (list/cover/fullsize or the playing background) can
// change while a card stays mounted. Keep the old frame until the replacement
// decodes; only a different beatmap should start from a blank frame.
watch(() => props.beatmapId, () => { loaded.value = false; failed.value = false; coverFallback.value = false; });
watch(src, () => { if (failed.value) loaded.value = false; failed.value = false; });
// Not every set ships a fullsize cover; fall back to the regular one instead of
// leaving a tall card blank.
const onError = () => {
  if (!props.live && props.variant === 'fullsize' && !coverFallback.value) coverFallback.value = true;
  else failed.value = true;
};
</script>

<template>
  <img v-if="src && !failed" :src="src" class="map-artwork" :data-loaded="loaded" alt="" aria-hidden="true" loading="lazy" decoding="async" referrerpolicy="no-referrer" @load="loaded = true" @error="onError">
</template>
