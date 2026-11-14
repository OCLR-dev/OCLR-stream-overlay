<script setup lang="ts">
import { computed } from 'vue';
import { useOverlay } from '../useOverlay';
import MapInfoCard from './MapInfoCard.vue';
const { state, view } = useOverlay();
const source = computed(() => ({ ...view.value, exTeam: state.exTeam }));
</script>

<template>
  <MapInfoCard :source="source" />
</template>
