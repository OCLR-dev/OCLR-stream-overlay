<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { teamFlagUrl, teamMonogram, type TeamImage } from '../teamFlag';

const props = withDefaults(defineProps<{ team?: TeamImage | null; name: string; decorative?: boolean }>(), { decorative: false });
const src = computed(() => teamFlagUrl(props.team));
const loaded = ref<string | null>(null);
const failed = ref<string | null>(null);
watch(src, () => { loaded.value = null; failed.value = null; }, { flush: 'sync' });
// Each URL owns a separate image node. A late load/error can only update that
// URL's status, so changing teams or image versions never revives the old flag.
const imageEvent = (event: Event, success: boolean) => {
  const url = (event.currentTarget as HTMLImageElement).getAttribute('src');
  if (url !== src.value) return;
  if (success) loaded.value = url;
  else failed.value = url;
};
const visible = computed(() => !!src.value && loaded.value === src.value && failed.value !== src.value);
</script>

<template>
  <figure class="team-flag" :role="decorative ? undefined : 'img'" :aria-label="decorative ? undefined : `${name}队旗${visible ? '' : '（首字标识）'}`" :aria-hidden="decorative || undefined">
    <span class="team-flag-frame">
      <span v-if="!visible" class="team-flag-monogram" aria-hidden="true">{{ teamMonogram(name) }}</span>
      <img v-if="src && failed !== src" :key="src" :src="src" :class="{ 'is-loaded': visible }" alt="" width="120" height="72" referrerpolicy="no-referrer" @load="imageEvent($event, true)" @error="imageEvent($event, false)" />
    </span>
  </figure>
</template>
