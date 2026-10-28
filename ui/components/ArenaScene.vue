<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import PovGrid from './PovGrid.vue';
import MapInfo from './MapInfo.vue';
defineProps<{ result?: boolean }>();
const { state, view } = useOverlay();
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === (result ? 'map-result' : 'playing') }"
    :hidden="state.scene !== (result ? 'map-result' : 'playing')" :data-scene-panel="result ? 'map-result' : 'playing'" :aria-label="result ? '单图结算' : 'Playing'">
    <div class="scene-body playing-body"><PovGrid :result="result" /></div>
    <footer class="scene-footer playing-footer">
      <div class="score-stage" :class="{ 'score-stage--result': result }" :id="result ? 'resultScoreStage' : 'scoreStage'" :data-lead="result ? 'left-small' : state.lead" role="group"
        :aria-label="`左队 RED 示例A队 ${result ? '队伍总分 ' + view.resultA : view.scoreA}，右队 BLUE 示例B队 ${result ? '队伍总分 ' + view.resultB : view.scoreB}`">
        <span class="score-center-anchor" aria-hidden="true"></span>
        <span class="score-fill" aria-hidden="true"></span>
        <div class="score-readout score-readout--a">
          <span class="score-side" aria-hidden="true">A · RED{{ result ? ' · 队伍总分' : '' }}</span>
          <strong class="score-number" :id="result ? 'resultTotalA' : 'scoreValueA'">{{ result ? view.resultA : view.scoreA }}</strong>
        </div>
        <div class="score-readout score-readout--b">
          <span class="score-side" aria-hidden="true">B · BLUE{{ result ? ' · 队伍总分' : '' }}</span>
          <strong class="score-number" :id="result ? 'resultTotalB' : 'scoreValueB'">{{ result ? view.resultB : view.scoreB }}</strong>
        </div>
      </div>
      <MapInfo :result="result" />
    </footer>
  </section>
</template>
