<script setup lang="ts">
import { vEmphasize } from '../motion';
import { useOverlay } from '../useOverlay';
import { computed } from 'vue';
import TeamFlagPreview from './TeamFlagPreview.vue';
import oclrLogo from '../assets/oclr-logo-light.svg';

const { state, view, motionScope } = useOverlay();
const arena = computed(() => ['playing', 'map-result'].includes(state.scene));
const score = (team: 'a' | 'b') => {
  if (!arena.value) return (team === 'a' ? state.seriesA : state.seriesB) ?? '—';
  const value = state.scene === 'map-result'
    ? (team === 'a' ? view.value.resultA : view.value.resultB)
    : (team === 'a' ? view.value.scoreA : view.value.scoreB);
  return value === '—' ? '0' : value;
};
</script>

<template>
  <header class="broadcast-header broadcast-header--flag-preview">
    <section class="team-block team-block--a" :aria-label="`左队（RED）：${view.names.a}`">
      <TeamFlagPreview team="a" />
      <span class="team-name">{{ view.names.a }}</span>
      <div class="header-score-line">
      <strong class="header-score" :class="{ 'header-score--series': !arena }" :id="state.scene === 'map-result' ? 'resultTotalA' : 'scoreValueA'"><span v-emphasize="{ value: state.seriesA, scope: motionScope, enabled: !arena }">{{ score('a') }}</span></strong>
      </div>
      <div class="series-row">
        <span v-emphasize="{ value: state.seriesA, scope: motionScope }" class="win-stars" data-series-stars="a" :aria-label="state.seriesA === null ? '赢图未知' : `已赢 ${state.seriesA} 图`"><i v-for="n in view.meta.target" :key="n" class="win-pip" :class="{ 'is-filled': n <= (state.seriesA ?? 0) }" aria-hidden="true"></i></span>
      </div>
    </section>

    <section class="event-block">
      <div class="event-logo"><strong v-if="view.brand" class="event-title--custom" :title="view.brand">{{ view.brand }}</strong><img v-else :src="oclrLogo" alt="OCLR" width="160" height="42" /></div>
      <div class="event-meta" :title="view.seriesTarget">
        <strong data-stage-label>{{ view.meta.label }}</strong>
        <span v-if="!view.brand">{{ view.season }}</span>
        <span data-series-target :aria-label="view.seriesTarget">{{ view.meta.format }}</span>
      </div>
    </section>

    <section class="team-block team-block--b" :aria-label="`右队（BLUE）：${view.names.b}`">
      <TeamFlagPreview team="b" />
      <span class="team-name">{{ view.names.b }}</span>
      <div class="header-score-line">
      <strong class="header-score" :class="{ 'header-score--series': !arena }" :id="state.scene === 'map-result' ? 'resultTotalB' : 'scoreValueB'"><span v-emphasize="{ value: state.seriesB, scope: motionScope, enabled: !arena }">{{ score('b') }}</span></strong>
      </div>
      <div class="series-row">
        <span v-emphasize="{ value: state.seriesB, scope: motionScope }" class="win-stars" data-series-stars="b" :aria-label="state.seriesB === null ? '赢图未知' : `已赢 ${state.seriesB} 图`"><i v-for="n in view.meta.target" :key="n" class="win-pip" :class="{ 'is-filled': n <= (state.seriesB ?? 0) }" aria-hidden="true"></i></span>
      </div>
    </section>
  </header>
</template>
