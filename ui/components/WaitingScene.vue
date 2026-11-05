<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import RosterFooter from './RosterFooter.vue';
import PovGrid from './PovGrid.vue';

const { state, view } = useOverlay();
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'waiting' }" :inert="state.scene !== 'waiting'" :aria-hidden="state.scene !== 'waiting'" data-scene-panel="waiting" aria-label="等待选手">
    <div class="scene-head waiting-head">
      <div class="title-line">
        <span class="scene-eyebrow">{{ view.meta.format }}</span>
        <h2>等待</h2>
      </div>
    </div>
    <div class="scene-body playing-body"><PovGrid waiting /></div>
    <RosterFooter />
  </section>
</template>
