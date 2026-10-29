<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import PovGrid from './PovGrid.vue';
import MapInfo from './MapInfo.vue';
import ChatPanel from './ChatPanel.vue';
import ChatBox from './ChatBox.vue';
import { computed } from 'vue';
const props = defineProps<{ result?: boolean }>();
const { state, view } = useOverlay();
const difference = computed(() => {
  const values = props.result ? [view.value.resultA, view.value.resultB] : [view.value.scoreA, view.value.scoreB];
  const delta = Number(values[0]!.replaceAll(',', '')) - Number(values[1]!.replaceAll(',', ''));
  if (!Number.isFinite(delta)) return '分数未知';
  return delta === 0 ? 'TIED / 平分' : `${delta > 0 ? '◀ ' : ''}+${Math.abs(delta).toLocaleString('en-US')}${delta < 0 ? ' ▶' : ''}`;
});
const actualLead = computed(() => {
  const a = props.result ? view.value.resultA : view.value.scoreA;
  const b = props.result ? view.value.resultB : view.value.scoreB;
  const delta = Number(a.replaceAll(',', '')) - Number(b.replaceAll(',', ''));
  return !Number.isFinite(delta) || delta === 0 ? 'equal' : delta > 0 ? 'left-small' : 'right-small';
});
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === (result ? 'map-result' : 'playing') }"
    :inert="state.scene !== (result ? 'map-result' : 'playing')" :aria-hidden="state.scene !== (result ? 'map-result' : 'playing')" :data-scene-panel="result ? 'map-result' : 'playing'" :aria-label="result ? '单图结算' : 'Playing'">
    <div class="scene-body playing-body"><PovGrid :result="result" /></div>
    <footer class="scene-footer playing-footer" :class="{ 'playing-footer--result': result }">
      <div class="score-stage" :class="{ 'score-stage--result': result }" :id="result ? 'resultScoreStage' : 'scoreStage'" :data-lead="view.shared ? actualLead : result ? 'left-small' : state.lead" role="group"
        :aria-label="`左队 RED ${view.names.a} ${result ? '队伍总分 ' + view.resultA : view.scoreA}，右队 BLUE ${view.names.b} ${result ? '队伍总分 ' + view.resultB : view.scoreB}`">
        <span class="score-center-anchor" aria-hidden="true"></span>
        <span class="score-fill" aria-hidden="true"></span>
        <span class="score-caption">{{ result ? 'MAP RESULT / 单图结算' : 'SCORE DIFFERENCE / 实时分差' }}</span>
        <strong class="score-delta">{{ difference }}</strong>
      </div>
      <ChatPanel v-if="result" />
      <template v-else>
        <MapInfo />
        <aside class="playing-stream-chat" aria-label="直播间聊天区域">
          <ChatBox source="stream" />
        </aside>
      </template>
    </footer>
  </section>
</template>
