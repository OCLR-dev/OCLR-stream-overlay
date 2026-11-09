<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import MapColumns from './MapColumns.vue';
import RosterFooter from './RosterFooter.vue';

const { state, view } = useOverlay();
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'mappool' }" :inert="state.scene !== 'mappool'" :aria-hidden="state.scene !== 'mappool'" data-scene-panel="mappool" aria-labelledby="mappool-title">
    <div class="scene-head mappool-head">
      <div class="title-line">
        <span class="scene-eyebrow">{{ view.pool.length }} 张谱面</span>
        <h2 id="mappool-title">图池</h2>
      </div>
    </div>

    <div class="scene-body mappool-body">
      <MapColumns />
    </div>
    <RosterFooter />
  </section>
</template>
