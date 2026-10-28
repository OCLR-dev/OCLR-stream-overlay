<script setup lang="ts">
import { useOverlay } from '../useOverlay';

const { state, view } = useOverlay();
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'victory' }" :hidden="state.scene !== 'victory'" data-scene-panel="victory" aria-labelledby="victory-title">
    <div class="scene-body victory-body">
      <div class="scene-head result-head">
        <div class="title-line">
          <span class="scene-eyebrow">SERIES RESULT / 05</span>
          <h2 id="victory-title">全场胜利</h2>
        </div>
      </div>

      <div class="victory-hero">
        <div class="victory-mark" aria-hidden="true">WINNER</div>
        <div class="victory-copy">
          <span class="victory-kicker">OCLR {{ view.season }} · <span data-victory-stage>{{ view.meta.label }}</span></span>
          <h3>{{ view.winner || '全场胜者待确认' }}</h3>
          <p class="victory-status">{{ view.names.a }} <span>VS</span> {{ view.names.b }}</p>
        </div>
        <div class="victory-result">
          <span>最终赢图</span>
          <strong><span>{{ state.seriesA ?? '—' }}</span><i>:</i><span>{{ state.seriesB ?? '—' }}</span></strong>
        </div>
      </div>

      <div class="victory-supports">
        <div>
          <span>赛制目标</span>
          <strong data-victory-target>{{ view.seriesTarget }}</strong>
        </div>
        <div>
          <span>比赛阶段</span>
          <strong data-victory-stage>{{ view.meta.label }}</strong>
        </div>
        <div>
          <span>常规人数</span>
          <strong data-mode-short>{{ state.mode }}</strong>
        </div>
        <div>
          <span>下一张图</span>
          <strong>无</strong>
        </div>
      </div>
    </div>

    <footer class="scene-footer">
      <section class="footer-cell">
        <span class="footer-kicker">全场胜者</span>
        <p class="footer-lead">{{ view.winner || '待确认' }}</p>
      </section>
      <section class="footer-cell">
        <span class="footer-kicker">赛制目标</span>
        <p class="footer-lead" data-victory-target>{{ view.seriesTarget }}</p>
      </section>
      <section class="footer-cell">
        <span class="footer-kicker">比赛阶段</span>
        <p data-victory-stage>{{ view.meta.label }}</p>
      </section>
    </footer>
  </section>
</template>
