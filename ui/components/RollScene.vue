<script setup lang="ts">
import { useOverlay } from '../useOverlay';
const { state, view } = useOverlay();
</script>
<template>
  <section class="scene" :hidden="state.scene !== 'roll'" :class="{ 'is-active': state.scene === 'roll' }" data-scene-panel="roll" aria-label="Roll 与先手">
    <div class="scene-body roll-body">
      <span class="scene-eyebrow">ROLL / FIRST ACTION</span><h2>ROLL</h2>
      <div class="roll-sides"><div v-for="team in (['a', 'b'] as const)" :key="team" :data-team="team"><h3>{{ view.names[team] }}</h3><strong>{{ view.roll?.[team] ?? '—' }}</strong></div></div>
      <p>Roll 胜方：{{ view.roll?.winner ? view.names[view.roll.winner] : '待记录真实结果' }}</p>
    </div>
    <footer class="scene-footer"><div class="footer-cell"><span class="footer-kicker">先 Pick</span><p>{{ view.roll?.pickFirst ? view.names[view.roll.pickFirst] : '未确认' }}</p></div><div class="footer-cell"><span class="footer-kicker">先 Ban</span><p>{{ view.roll?.banFirst ? view.names[view.roll.banFirst] : '未确认' }}</p></div><div class="footer-cell"><span class="footer-kicker">比赛操作</span><p>实际 Roll 结果由直播员记录</p></div></footer>
  </section>
</template>
