<script setup lang="ts">
import { vEmphasize } from '../motion';
import { useOverlay } from '../useOverlay';

const { state, view, motionScope } = useOverlay();
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'victory' }" :inert="state.scene !== 'victory'" :aria-hidden="state.scene !== 'victory'" data-scene-panel="victory" aria-labelledby="victory-title">
    <div class="scene-body victory-body">
      <div class="scene-head result-head">
        <div class="title-line">
          <span class="scene-eyebrow">SERIES RESULT / 05</span>
          <h2 id="victory-title">全场胜利</h2>
        </div>
      </div>

      <div class="victory-hero">
        <div class="victory-mark" aria-hidden="true">WINNER</div>
        <div class="victory-copy" v-emphasize="{ value: view.winner, scope: motionScope, enabled: state.scene === 'victory', kind: 'winner' }">
          <span class="victory-kicker">OCLR {{ view.season }} · <span data-victory-stage>{{ view.meta.label }}</span></span>
          <h3>{{ view.winner || '全场胜者待确认' }}</h3>
          <p class="victory-status">{{ view.names.a }} <span>VS</span> {{ view.names.b }}</p>
        </div>
        <div class="victory-result">
          <span>最终赢图</span>
          <strong><span>{{ state.seriesA ?? '—' }}</span><i>:</i><span>{{ state.seriesB ?? '—' }}</span></strong>
        </div>
      </div>
    </div>
  </section>
</template>
