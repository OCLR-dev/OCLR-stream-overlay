<script setup lang="ts">
import { useOverlay } from '../useOverlay';

const { state, view } = useOverlay();
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'pause' }" :hidden="state.scene !== 'pause'" data-scene-panel="pause" aria-labelledby="pause-title">
    <div class="scene-body pause-body">
      <div class="scene-head pause-head">
        <div class="title-line">
          <span class="scene-eyebrow">MATCH ON HOLD / 06</span>
          <h2 id="pause-title" data-pause-title>{{ view.pauseTitle }}</h2>
        </div>
      </div>

      <div class="pause-layout">
        <section class="pause-primary">
          <div class="pause-mark" aria-hidden="true"><span></span><span></span></div>
          <h3 data-pause-headline>{{ view.pauseTitle }}</h3>
          <p class="pause-time" v-show="state.pauseType === 'tactical'" data-pause-duration>暂定 3:00</p>
          <p class="pause-recovery">恢复时间：未确认</p>
        </section>

        <section class="pause-side">
          <div class="pause-row"><span>暂停类型</span><strong data-pause-type-label>{{ view.pauseTypeLabel }}</strong></div>
          <div class="pause-row"><span>A 队战术暂停</span><strong data-pause-a-status>{{ view.pauseA }}</strong></div>
          <div class="pause-row"><span>B 队战术暂停</span><strong data-pause-b-status>{{ view.pauseB }}</strong></div>
          <div class="pause-row"><span>断线重赛机会</span><strong data-rematch-status>{{ view.rematch }}</strong></div>
          <div class="pause-row"><span>当前谱面</span><strong>{{ view.shared ? view.currentMap?.title || view.currentMap?.label || '未选择' : '谱面标题占位' }}</strong></div>
        </section>
      </div>
    </div>

    <footer class="scene-footer">
      <section class="footer-cell">
        <span class="footer-kicker">暂停类型</span>
        <p class="footer-lead" data-pause-footer-type>{{ view.pauseTypeLabel }}</p>
      </section>
      <section class="footer-cell">
        <span class="footer-kicker">恢复时间</span>
        <p class="footer-lead">未确认</p>
      </section>
      <section class="footer-cell">
        <span class="footer-kicker">当前谱面</span>
        <p>{{ view.shared ? view.currentMap?.title || view.currentMap?.label || '未选择' : '谱面标题占位' }}</p>
      </section>
    </footer>
  </section>
</template>
