<script setup lang="ts">
import { vEmphasize } from '../motion';
import { useOverlay } from '../useOverlay';
import TeamFlagPreview from './TeamFlagPreview.vue';
import HeaderAmbient from './HeaderAmbient.vue';
import oclrLogo from '../assets/oclr-logo-light.svg';

const { state, view, motionScope, motionReady } = useOverlay();
// The header score is the series score in every scene. The live in-game total
// stays in the capture and the Playing difference band, so switching scenes no
// longer changes the meaning, size or visibility of this module.
const score = (team: 'a' | 'b') => (team === 'a' ? state.seriesA : state.seriesB) ?? '—';
</script>

<template>
  <header class="broadcast-header broadcast-header--flag-preview">
    <HeaderAmbient />
    <section class="team-block team-block--a" :aria-label="`左队（RED）：${view.names.a}`">
      <TeamFlagPreview team="a" />
      <span class="team-name">{{ view.names.a }}</span>
      <div class="header-score-line">
      <strong class="header-score" id="scoreValueA"><span v-emphasize="{ value: state.seriesA, scope: motionScope }">{{ score('a') }}</span></strong>
      </div>
      <div class="series-row">
        <span class="win-stars" data-series-stars="a" :aria-label="state.seriesA === null ? '赢图未知' : `已赢 ${state.seriesA} 图`"><i v-for="n in view.meta.target" :key="n" v-emphasize="{ value: n <= (state.seriesA ?? 0), scope: `${motionScope}:${view.meta.target}`, enabled: motionReady && state.seriesA !== null, kind: 'pip' }" class="win-pip" :class="{ 'is-filled': n <= (state.seriesA ?? 0) }" aria-hidden="true"></i></span>
      </div>
    </section>

    <section class="event-block">
      <div class="event-logo"><img :src="oclrLogo" alt="OCLR" width="160" height="42" /></div>
      <div class="event-meta">
        <strong data-stage-label>{{ view.meta.label }}</strong>
      </div>
    </section>

    <section class="team-block team-block--b" :aria-label="`右队（BLUE）：${view.names.b}`">
      <TeamFlagPreview team="b" />
      <span class="team-name">{{ view.names.b }}</span>
      <div class="header-score-line">
      <strong class="header-score" id="scoreValueB"><span v-emphasize="{ value: state.seriesB, scope: motionScope }">{{ score('b') }}</span></strong>
      </div>
      <div class="series-row">
        <span class="win-stars" data-series-stars="b" :aria-label="state.seriesB === null ? '赢图未知' : `已赢 ${state.seriesB} 图`"><i v-for="n in view.meta.target" :key="n" v-emphasize="{ value: n <= (state.seriesB ?? 0), scope: `${motionScope}:${view.meta.target}`, enabled: motionReady && state.seriesB !== null, kind: 'pip' }" class="win-pip" :class="{ 'is-filled': n <= (state.seriesB ?? 0) }" aria-hidden="true"></i></span>
      </div>
    </section>
  </header>
</template>
