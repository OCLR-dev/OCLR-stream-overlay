<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import { sceneLabels } from '../model';
import { computed } from 'vue';

const { state, view } = useOverlay();
const arena = computed(() => ['playing', 'map-result'].includes(state.scene));
const score = (team: 'a' | 'b') => {
  if (!arena.value) return (team === 'a' ? state.seriesA : state.seriesB) ?? '—';
  return state.scene === 'map-result'
    ? (team === 'a' ? view.value.resultA : view.value.resultB)
    : (team === 'a' ? view.value.scoreA : view.value.scoreB);
};
</script>

<template>
  <header class="broadcast-header">
    <section class="team-block team-block--a" :aria-label="`左队（RED）：${view.names.a}`">
      <span class="team-side">左队 / RED · A SIDE</span>
      <span class="team-name">{{ view.names.a }}</span>
      <strong class="header-score" :class="{ 'header-score--series': !arena }" :id="state.scene === 'map-result' ? 'resultTotalA' : 'scoreValueA'">{{ score('a') }}</strong>
      <span class="header-score-label">{{ arena ? (state.scene === 'map-result' ? '本图总分 / MAP SCORE' : '当前总分 / TEAM SCORE') : '系列赢图 / SERIES' }}</span>
      <div class="series-row">
        <span class="series-label">赢图</span>
        <span class="win-stars" data-series-stars="a" :aria-label="state.seriesA === null ? '赢图未知' : `已赢 ${state.seriesA} 图`"><i v-for="n in view.meta.target" :key="n" class="win-pip" :class="{ 'is-filled': n <= (state.seriesA ?? 0) }" aria-hidden="true"></i></span>
      </div>
    </section>

    <section class="event-block">
      <div class="event-shield"><span class="event-title">OCLR <b>{{ view.season }}</b></span><span class="event-bo">{{ view.meta.format }}</span></div>
      <span class="event-meta"><span data-stage-label>{{ view.meta.label }}</span> · <span data-series-target>{{ view.seriesTarget }}</span></span>
      <span class="event-context">
        <span class="event-context-line"><span data-header-scene>{{ sceneLabels[state.scene] }}</span> · <span class="format-chip" :data-format="view.format" data-format-label>{{ view.formatLabel }}</span></span>
        <span class="event-context-line">常规 <span data-mode-label>{{ state.mode }}</span> · 当前 <span data-active-mode-label>{{ view.modeLabel }}</span></span>
      </span>
      <span class="layout-mark">{{ view.shared ? view.title : '布局示意' }}</span>
    </section>

    <section class="team-block team-block--b" :aria-label="`右队（BLUE）：${view.names.b}`">
      <span class="team-side">右队 / BLUE · B SIDE</span>
      <span class="team-name">{{ view.names.b }}</span>
      <strong class="header-score" :class="{ 'header-score--series': !arena }" :id="state.scene === 'map-result' ? 'resultTotalB' : 'scoreValueB'">{{ score('b') }}</strong>
      <span class="header-score-label">{{ arena ? (state.scene === 'map-result' ? '本图总分 / MAP SCORE' : '当前总分 / TEAM SCORE') : '系列赢图 / SERIES' }}</span>
      <div class="series-row">
        <span class="series-label">赢图</span>
        <span class="win-stars" data-series-stars="b" :aria-label="state.seriesB === null ? '赢图未知' : `已赢 ${state.seriesB} 图`"><i v-for="n in view.meta.target" :key="n" class="win-pip" :class="{ 'is-filled': n <= (state.seriesB ?? 0) }" aria-hidden="true"></i></span>
      </div>
    </section>
  </header>
</template>
