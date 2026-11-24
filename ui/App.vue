<script setup lang="ts">
import { computed, provide } from 'vue';
import { vSceneReveal } from './motion';
import { createOverlay, overlayKey, useCanvasFit } from './useOverlay';
import { sceneLabels } from './model';
import { scoreDifference } from './scoreDifference';
import ReviewControls from './components/ReviewControls.vue';
import BroadcastHeader from './components/BroadcastHeader.vue';
import BroadcastAmbient from './components/BroadcastAmbient.vue';
import SpectrumGrid from './components/SpectrumGrid.vue';
import LazerRibbonEdge from './components/LazerRibbonEdge.vue';
import ChatPanel from './components/ChatPanel.vue';
import WaitingScene from './components/WaitingScene.vue';
import MappoolScene from './components/MappoolScene.vue';
import ArenaScene from './components/ArenaScene.vue';
import VictoryScene from './components/VictoryScene.vue';
import PauseScene from './components/PauseScene.vue';
import RollScene from './components/RollScene.vue';

const shared = location.pathname === '/overlay';
const controller = createOverlay(shared);
provide(overlayKey, controller);
const { state, view, motionReady, motionScope } = controller;
const { stage, scale } = useCanvasFit();
// Chat mounts once outside the scene stack. Scene changes only toggle its
// visibility, so neither chat surface is re-created or reloaded. Pause keeps
// the same bottom chat and map layout as Playing.
const chatScene = new Set(['waiting', 'roll', 'mappool', 'playing', 'victory', 'pause']);
const chatVisible = computed(() => chatScene.has(state.scene));
const playingScoreBar = computed(() => scoreDifference(view.value.scoreA, view.value.scoreB));
const canvasLead = computed(() => {
  if (state.scene !== 'playing') return 'equal';
  if (!view.value.shared) {
    if (state.lead.startsWith('left')) return 'left';
    if (state.lead.startsWith('right')) return 'right';
    return 'equal';
  }
  const delta = playingScoreBar.value.delta;
  return delta === null || delta === 0 ? 'equal' : delta > 0 ? 'left' : 'right';
});
const leadIntensity = computed(() => {
  if (state.scene !== 'playing' || canvasLead.value === 'equal') return 0;
  return Number(Math.min(1, Math.abs(playingScoreBar.value.scale)).toFixed(3));
});
const activeMapMod = computed(() => {
  if (view.value.shared) return view.value.currentMap?.mod || (state.mapType === 'tb' ? 'TB' : state.mapMod);
  return state.mapType === 'tb' ? 'TB' : state.mapMod;
});
</script>

<template>
  <div class="review-app" id="reviewApp">
    <ReviewControls v-if="!shared" />
    <main class="canvas-stage" id="canvasStage" ref="stage">
      <div class="canvas-sizer" id="canvasSizer" :style="{ width: `${1920 * scale}px`, height: `${1080 * scale}px` }">
        <div class="broadcast-canvas" id="broadcastCanvas"
          :class="[`mode-${state.mode}`, `layout-${view.count}v${view.count}`, `source-${state.source}`, { 'shared-output': shared, 'motion-ready': motionReady }]"
          :data-mode="state.mode" :data-base-mode="state.mode" :data-active-mode="`${view.count}v${view.count}`" :data-ex-layout="view.ex ? '1' : '0'" :data-ex-team="view.ex ? state.exTeam : 'none'" :data-lead="canvasLead" :data-map-mod="activeMapMod" :data-current-scene="state.scene" :data-winner-team="view.winnerTeam || (view.drawnExhibition ? 'draw' : 'none')" :data-championship="view.isChampionship ? '1' : '0'"
          :aria-label="`1920×1080 OCLR ${view.season} ${shared ? '共享直播输出' : '直播布局示意画布'}，当前场景：${sceneLabels[state.scene]}，常规 ${state.mode}，当前 ${view.modeLabel}`"
          :style="{ transform: `scale(${scale})`, '--lead-intensity': leadIntensity }">
          <div class="canvas-mood-glow" aria-hidden="true"></div>
          <SpectrumGrid />
          <BroadcastAmbient />
          <LazerRibbonEdge />
          <BroadcastHeader />
          <!-- One Playing capture grid remains mounted through gameplay and Ranking. -->
          <div class="scene-stack" v-scene-reveal="{ value: state.scene, scope: motionScope, enabled: motionReady }">
            <WaitingScene />
            <MappoolScene />
            <ArenaScene />
            <VictoryScene />
            <PauseScene />
            <RollScene />
          </div>
          <div class="broadcast-chat" data-broadcast-chat :data-visible="chatVisible ? 'true' : 'false'"
            :aria-hidden="!chatVisible">
            <ChatPanel />
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
