<script setup lang="ts">
import PlayerRoster from './PlayerRoster.vue';
</script>

<template>
  <footer class="scene-footer roster-footer" aria-label="双方选手卡">
    <div class="roster-footer-grid">
      <PlayerRoster team="a" />
      <PlayerRoster team="b" />
    </div>
  </footer>
</template>
