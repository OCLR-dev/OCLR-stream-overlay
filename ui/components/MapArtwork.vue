<script setup lang="ts">
import { computed, ref, watch } from 'vue';
const props = defineProps<{ beatmapId?: number | null; live?: boolean }>();
const loaded = ref(false);
const failed = ref(false);
const src = computed(() => Number.isSafeInteger(props.beatmapId) && props.beatmapId! > 0 ? `/api/beatmaps/${props.beatmapId}/${props.live ? 'background' : 'cover'}` : null);
watch(src, () => { loaded.value = false; failed.value = false; });
</script>

<template>
  <img v-if="src && !failed" :key="src" :src="src" class="map-artwork" :data-loaded="loaded" alt="" aria-hidden="true" loading="lazy" decoding="async" referrerpolicy="no-referrer" @load="loaded = true" @error="failed = true">
</template>
