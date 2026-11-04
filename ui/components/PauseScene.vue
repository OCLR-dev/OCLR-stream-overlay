<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import MapInfo from './MapInfo.vue';

const { state, view } = useOverlay();
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'pause' }" :inert="state.scene !== 'pause'" :aria-hidden="state.scene !== 'pause'" data-scene-panel="pause" aria-labelledby="pause-title">
    <div class="scene-body pause-body">
      <div class="scene-head pause-head">
        <div class="title-line">
          <span class="scene-eyebrow">比赛暂停</span>
          <h2 id="pause-title" data-pause-title>{{ view.pauseTitle }}</h2>
        </div>
      </div>

      <div class="pause-layout">
        <section class="pause-primary">
          <div class="pause-stripes" aria-hidden="true"></div>
          <div class="pause-mark" aria-hidden="true"><span></span><span></span></div>
          <h3 data-pause-headline>{{ view.pauseTitle }}</h3>
          <div v-if="view.pauseClock" class="pause-countdown" :class="{ 'is-ended': view.pauseTimerEnded }" data-pause-countdown>
            <span>暂停剩余</span>
            <strong :class="{ 'is-soon': view.pauseTimerEnded }">{{ view.pauseTimerEnded ? '即将开始...' : view.pauseClock }}</strong>
          </div>
        </section>

        <section class="pause-side">
          <div class="pause-row"><span>暂停类型</span><strong data-pause-type-label>{{ view.pauseTypeLabel }}</strong></div>
          <div class="pause-row"><span>A 队战术暂停</span><strong data-pause-a-status>{{ view.pauseA }}</strong></div>
          <div class="pause-row"><span>B 队战术暂停</span><strong data-pause-b-status>{{ view.pauseB }}</strong></div>
          <div class="pause-row"><span>断线重赛机会</span><strong data-rematch-status>{{ view.rematch }}</strong></div>
        </section>
      </div>
    </div>

    <footer class="scene-footer playing-footer pause-footer">
      <MapInfo />
    </footer>
  </section>
</template>
