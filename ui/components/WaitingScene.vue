<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import PlayerRoster from './PlayerRoster.vue';
import PovGrid from './PovGrid.vue';

const { state } = useOverlay();
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'waiting' }" :inert="state.scene !== 'waiting'" :aria-hidden="state.scene !== 'waiting'" data-scene-panel="waiting" aria-label="等待选手">
    <div class="scene-body playing-body"><PovGrid waiting /></div>
    <footer class="scene-footer waiting-footer" aria-label="选手到场与就绪状态">
      <PlayerRoster team="a" />
      <PlayerRoster team="b" />
    </footer>
  </section>
</template>
