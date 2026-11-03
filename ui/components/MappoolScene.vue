<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import MapColumns from './MapColumns.vue';
import RosterFooter from './RosterFooter.vue';

const { state } = useOverlay();
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'mappool' }" :inert="state.scene !== 'mappool'" :aria-hidden="state.scene !== 'mappool'" data-scene-panel="mappool" aria-labelledby="mappool-title">
    <div class="scene-body mappool-body">
      <div class="scene-head mappool-head">
        <div class="title-line">
          <span class="scene-eyebrow">禁用 / 选择 · 02</span>
          <h2 id="mappool-title">MAPPOOL</h2>
        </div>
      </div>

      <MapColumns />
    </div>
    <RosterFooter />
  </section>
</template>
