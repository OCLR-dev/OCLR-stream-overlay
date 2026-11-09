<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import PovGrid from './PovGrid.vue';
import MapInfo from './MapInfo.vue';
import { computed } from 'vue';
import { scoreDifference } from '../scoreDifference';
import { formatTeamScore } from '../scoreFormat';
const { state, view } = useOverlay();
const scoreBar = computed(() => scoreDifference(
  view.value.scoreA,
  view.value.scoreB
));
const difference = computed(() => {
  const delta = scoreBar.value.delta;
  if (delta === null) return '分数未知';
  return delta === 0 ? 'TIED / 平分' : `${delta > 0 ? '◀ ' : ''}+${formatTeamScore(Math.abs(delta))}${delta < 0 ? ' ▶' : ''}`;
});
const actualLead = computed(() => {
  const delta = scoreBar.value.delta;
  return delta === null || delta === 0 ? 'equal' : delta > 0 ? 'left-small' : 'right-small';
});
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'playing' }"
    :inert="state.scene !== 'playing'" :aria-hidden="state.scene !== 'playing'" data-scene-panel="playing" aria-label="Playing">
    <div class="scene-body playing-body"><PovGrid /></div>
    <footer class="scene-footer playing-footer">
      <div class="score-stage" id="scoreStage" :data-lead="view.shared ? actualLead : state.lead" role="group"
        :aria-label="`左队 RED ${view.names.a} ${view.scoreA}，右队 BLUE ${view.names.b} ${view.scoreB}`">
        <span class="score-center-anchor" aria-hidden="true"></span>
        <span class="score-fill" :style="{ transform: `scaleX(${scoreBar.scale})` }" aria-hidden="true"></span>
        <span class="score-tip" :style="{ transform: `translateX(${scoreBar.scale * 100}%)`, opacity: scoreBar.scale === 0 ? 0 : 1 }" aria-hidden="true"></span>
        <span class="score-caption">SCORE DIFFERENCE / 实时分差</span>
        <strong v-show="view.showPlayingScores" class="score-delta">{{ difference }}</strong>
      </div>
      <MapInfo />
    </footer>
  </section>
</template>
