<script setup lang="ts">
import { provide } from 'vue';
import { createOverlay, overlayKey, useCanvasFit } from './useOverlay';
import { sceneLabels } from './model';
import ReviewControls from './components/ReviewControls.vue';
import BroadcastHeader from './components/BroadcastHeader.vue';
import WaitingScene from './components/WaitingScene.vue';
import MappoolScene from './components/MappoolScene.vue';
import ArenaScene from './components/ArenaScene.vue';
import VictoryScene from './components/VictoryScene.vue';
import PauseScene from './components/PauseScene.vue';
import RollScene from './components/RollScene.vue';

const shared = location.pathname === '/overlay';
const controller = createOverlay(shared);
provide(overlayKey, controller);
const { state, view, motionReady } = controller;
const { stage, scale } = useCanvasFit();
</script>

<template>
  <div class="review-app" id="reviewApp">
    <ReviewControls v-if="!shared" />
    <main class="canvas-stage" id="canvasStage" ref="stage">
      <div class="canvas-sizer" id="canvasSizer" :style="{ width: `${1920 * scale}px`, height: `${1080 * scale}px` }">
        <div class="broadcast-canvas" id="broadcastCanvas"
          :class="[`mode-${state.mode}`, `layout-${view.count}v${view.count}`, `source-${state.source}`, { 'shared-output': shared, 'motion-ready': motionReady }]"
          :data-mode="state.mode" :data-base-mode="state.mode" :data-active-mode="`${view.count}v${view.count}`" :data-ex-layout="view.ex ? '1' : '0'" :data-current-scene="state.scene"
          :aria-label="`1920×1080 OCLR ${view.season} ${shared ? '共享直播输出' : '直播布局示意画布'}，当前场景：${sceneLabels[state.scene]}，常规 ${state.mode}，当前 ${view.modeLabel}`"
          :style="{ transform: `scale(${scale})` }">
          <BroadcastHeader />
          <!-- One Playing capture grid remains mounted through gameplay and Ranking. -->
          <div class="scene-stack">
            <WaitingScene />
            <MappoolScene />
            <ArenaScene />
            <VictoryScene />
            <PauseScene />
            <RollScene />
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
