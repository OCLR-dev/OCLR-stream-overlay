<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ name: string; decorative?: boolean }>();
const monogram = computed(() => Array.from(props.name.trim()).slice(0, 2).join('').toLocaleUpperCase() || '?');
</script>

<template>
  <figure class="team-flag" :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : `${name}（首字标识）`" :aria-hidden="decorative || undefined">
    <span class="team-flag-frame">
      <span class="team-flag-monogram" aria-hidden="true">{{ monogram }}</span>
    </span>
  </figure>
</template>
