<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import ChatBox from './ChatBox.vue';
import PlayerRoster from './PlayerRoster.vue';
import PovGrid from './PovGrid.vue';

const { state } = useOverlay();
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'waiting' }" :inert="state.scene !== 'waiting'" :aria-hidden="state.scene !== 'waiting'" data-scene-panel="waiting" aria-label="等待选手">
    <div class="scene-body playing-body"><PovGrid waiting /></div>
    <footer class="scene-footer waiting-footer" aria-label="比赛聊天、选手卡与直播间聊天">
      <div class="waiting-room-chat"><ChatBox source="match" compact /></div>
      <div class="waiting-rosters">
        <PlayerRoster team="a" />
        <PlayerRoster team="b" />
      </div>
      <div class="waiting-stream-chat"><ChatBox source="stream" compact /></div>
    </footer>
  </section>
</template>
