<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import { sceneLabels } from '../model';

const { state, view } = useOverlay();
</script>

<template>
  <header class="broadcast-header">
    <section class="team-block team-block--a" aria-label="左队（RED）：示例A队">
      <span class="team-side">左队 / RED · A SIDE</span>
      <span class="team-name">示例A队</span>
      <div class="series-row">
        <span class="series-label">赢图</span>
        <span class="win-stars" data-series-stars="a" :aria-label="state.seriesA === null ? '赢图未知' : `已赢 ${state.seriesA} 图`">{{ Array.from({ length: view.meta.target }, (_, i) => i < (state.seriesA ?? 0) ? '★' : '☆').join(' ') }}</span>
      </div>
    </section>

    <section class="event-block">
      <span class="layout-mark">布局示意</span>
      <span class="event-title">OCLR S11</span>
      <span class="event-meta"><span data-stage-label>{{ view.meta.label }}</span> · <span data-series-target>{{ view.seriesTarget }}</span></span>
      <span class="event-context">
        <span class="event-context-line"><span data-header-scene>{{ sceneLabels[state.scene] }}</span> · <span class="format-chip" :data-format="view.format" data-format-label>{{ view.formatLabel }}</span></span>
        <span class="event-context-line">常规 <span data-mode-label>{{ state.mode }}</span> · 当前 <span data-active-mode-label>{{ view.modeLabel }}</span></span>
      </span>
    </section>

    <section class="team-block team-block--b" aria-label="右队（BLUE）：示例B队">
      <span class="team-side">右队 / BLUE · B SIDE</span>
      <span class="team-name">示例B队</span>
      <div class="series-row">
        <span class="series-label">赢图</span>
        <span class="win-stars" data-series-stars="b" :aria-label="state.seriesB === null ? '赢图未知' : `已赢 ${state.seriesB} 图`">{{ Array.from({ length: view.meta.target }, (_, i) => i < (state.seriesB ?? 0) ? '★' : '☆').join(' ') }}</span>
      </div>
    </section>
  </header>
</template>
