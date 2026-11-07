<script setup lang="ts">
import { computed } from 'vue';
import ScoreCounter from './ScoreCounter.vue';
import { vEmphasize } from '../motion';
import { useOverlay } from '../useOverlay';
import { modColorStyle } from '../modColors';
import TeamFlagPreview from './TeamFlagPreview.vue';
import TeamNameMarquee from './TeamNameMarquee.vue';
import HeaderAmbient from './HeaderAmbient.vue';
import TeamBlockParticles from './TeamBlockParticles.vue';
import MapWinBanner from './MapWinBanner.vue';
import oclrLogo from '../assets/oclr-logo-light.svg';

const { state, view, motionScope, motionReady, session } = useOverlay();
// Playing crossfades the room total over the series score once both sides have
// arrived; the series value stays beside the win pips as a small gilded number.
// Every other scene keeps only the series score.
const received = (value: string) => /^\d[\d,]*$/.test(value);
const roomTotals = computed(() => (state.scene === 'playing' || view.value.warmup) &&
  received(view.value.scoreA) && received(view.value.scoreB));
// Interpolate only fresh Playing updates. Joining, reconnecting,
// Ranking, corrections and a new run establish a silent exact-score baseline.
const scoreMotion = computed(() => roomTotals.value && motionReady.value &&
  (!view.value.shared || view.value.connection === 'synced' && view.value.roomIpc === 3));
const scoreScope = computed(() => JSON.stringify([motionScope.value, session.value?.currentRoundId,
  session.value?.rounds.find(r => r.id === session.value?.currentRoundId)?.runId,
  view.value.currentMap?.beatmapId, view.value.warmup]));
const seriesScore = (team: 'a' | 'b') => (team === 'a' ? state.seriesA : state.seriesB) ?? '—';
// Ban/EX status sits under each team title in every scene so the header keeps
// the same two-line structure instead of changing between scenes.
const banBadge = (team: 'a' | 'b', index: 0 | 1) => view.value.banMap(team, index);
const banBadgeStyle = (team: 'a' | 'b', index: 0 | 1) => {
  const badge = banBadge(team, index);
  return badge ? modColorStyle(badge.mod) : undefined;
};
const banBadgeText = (team: 'a' | 'b', index: 0 | 1) => {
  const badge = banBadge(team, index);
  if (!badge) return '?';
  return `${badge.mod}${badge.number || '?'}`;
};
</script>

<template>
  <header class="broadcast-header broadcast-header--flag-preview" :data-warmup="view.warmup ? 'true' : undefined">
    <HeaderAmbient />
    <section class="team-block team-block--a" :aria-label="`左队（RED）：${view.names.a}`">
      <TeamBlockParticles />
      <TeamFlagPreview team="a" />
      <TeamNameMarquee :name="view.names.a" />
      <div class="header-bans header-bans--a" data-header-bans="a" role="group" :aria-label="`${view.names.a} 先手、禁用与 EX 状态`">
        <span class="ban-group">
          <span class="ban-label">禁用：</span>
          <span class="ban-badges">
            <span class="ban-index" :class="{ 'ban-index--empty': !banBadge('a', 0) }" :style="banBadgeStyle('a', 0)" data-ban-slot-view="a0" :data-ban-label="view.banText('a', 0)" :aria-label="`Ban 1 ${view.banText('a', 0)}`" :title="view.banText('a', 0)">{{ banBadgeText('a', 0) }}</span>
            <span class="ban-index" :class="{ 'ban-index--empty': !banBadge('a', 1) }" :style="banBadgeStyle('a', 1)" data-ban-slot-view="a1" :data-ban-label="view.banText('a', 1)" :aria-label="`Ban 2 ${view.banText('a', 1)}`" :title="view.banText('a', 1)">{{ banBadgeText('a', 1) }}</span>
          </span>
        </span>
        <span v-if="state.pickFirst === 'a'" class="mappool-first-action" data-first-action="pick">先选择</span>
        <span v-if="state.banFirst === 'a'" class="mappool-first-action" data-first-action="ban">先禁用</span>
        <span v-if="!view.exhibition" class="ex-counter">EX 剩余 <b data-ex-remaining="a">{{ state.exA }}</b></span>
        <span v-if="view.ex && state.exTeam === 'a'" class="map-ex-mark" data-mappool-ex data-ex-team="a">EX 开启</span>
      </div>
      <div class="header-score-line">
      <span class="header-score-stack">
        <strong v-if="!view.warmup" class="header-score header-score--series" :class="{ 'is-visible': !roomTotals }" :id="roomTotals ? undefined : 'scoreValueA'" data-score-source="series" :aria-hidden="roomTotals" :aria-label="`系列赢图 ${seriesScore('a')}`"><span v-emphasize="{ value: seriesScore('a'), scope: `${motionScope}:series`, enabled: motionReady && !roomTotals }">{{ seriesScore('a') }}</span></strong>
        <strong class="header-score header-score--room" :class="{ 'is-visible': roomTotals }" :id="roomTotals ? 'scoreValueA' : undefined" data-score-source="room" :aria-hidden="!roomTotals" :aria-label="`本图实时队分 ${view.scoreA}`"><ScoreCounter :value="view.scoreA" :scope="scoreScope" :enabled="scoreMotion" /></strong>
      </span>
      </div>
      <div v-if="!view.warmup" class="series-row">
        <span class="series-mini" :class="{ 'is-visible': roomTotals }" data-series-mini="a" :aria-hidden="!roomTotals" :aria-label="`系列赢图 ${seriesScore('a')}`">{{ seriesScore('a') }}</span>
        <span class="win-stars" data-series-stars="a" :aria-label="state.seriesA === null ? '赢图未知' : `已赢 ${state.seriesA} 图`"><i v-for="n in view.meta.target" :key="n" v-emphasize="{ value: n <= (state.seriesA ?? 0), scope: `${motionScope}:${view.meta.target}`, enabled: motionReady && state.seriesA !== null, kind: 'pip' }" class="win-pip" :class="{ 'is-filled': n <= (state.seriesA ?? 0) }" aria-hidden="true"></i></span>
      </div>
    </section>

    <section class="event-block">
      <div class="event-logo"><img :src="oclrLogo" alt="OCLR" width="160" height="42" /></div>
      <div class="event-meta">
        <strong data-stage-label>{{ view.warmup ? 'Warm-up' : view.meta.label }}</strong>
        <span v-if="view.exhibition && !view.warmup">{{ view.meta.format }}</span>
      </div>
    </section>

    <section class="team-block team-block--b" :aria-label="`右队（BLUE）：${view.names.b}`">
      <TeamBlockParticles />
      <TeamFlagPreview team="b" />
      <TeamNameMarquee :name="view.names.b" />
      <div class="header-bans header-bans--b" data-header-bans="b" role="group" :aria-label="`${view.names.b} 先手、禁用与 EX 状态`">
        <span class="ban-group">
          <span class="ban-label">禁用：</span>
          <span class="ban-badges">
            <span class="ban-index" :class="{ 'ban-index--empty': !banBadge('b', 0) }" :style="banBadgeStyle('b', 0)" data-ban-slot-view="b0" :data-ban-label="view.banText('b', 0)" :aria-label="`Ban 1 ${view.banText('b', 0)}`" :title="view.banText('b', 0)">{{ banBadgeText('b', 0) }}</span>
            <span class="ban-index" :class="{ 'ban-index--empty': !banBadge('b', 1) }" :style="banBadgeStyle('b', 1)" data-ban-slot-view="b1" :data-ban-label="view.banText('b', 1)" :aria-label="`Ban 2 ${view.banText('b', 1)}`" :title="view.banText('b', 1)">{{ banBadgeText('b', 1) }}</span>
          </span>
        </span>
        <span v-if="state.pickFirst === 'b'" class="mappool-first-action" data-first-action="pick">先选择</span>
        <span v-if="state.banFirst === 'b'" class="mappool-first-action" data-first-action="ban">先禁用</span>
        <span v-if="!view.exhibition" class="ex-counter">EX 剩余 <b data-ex-remaining="b">{{ state.exB }}</b></span>
        <span v-if="view.ex && state.exTeam === 'b'" class="map-ex-mark" data-mappool-ex data-ex-team="b">EX 开启</span>
      </div>
      <div class="header-score-line">
      <span class="header-score-stack">
        <strong v-if="!view.warmup" class="header-score header-score--series" :class="{ 'is-visible': !roomTotals }" :id="roomTotals ? undefined : 'scoreValueB'" data-score-source="series" :aria-hidden="roomTotals" :aria-label="`系列赢图 ${seriesScore('b')}`"><span v-emphasize="{ value: seriesScore('b'), scope: `${motionScope}:series`, enabled: motionReady && !roomTotals }">{{ seriesScore('b') }}</span></strong>
        <strong class="header-score header-score--room" :class="{ 'is-visible': roomTotals }" :id="roomTotals ? 'scoreValueB' : undefined" data-score-source="room" :aria-hidden="!roomTotals" :aria-label="`本图实时队分 ${view.scoreB}`"><ScoreCounter :value="view.scoreB" :scope="scoreScope" :enabled="scoreMotion" /></strong>
      </span>
      </div>
      <div v-if="!view.warmup" class="series-row">
        <span class="series-mini" :class="{ 'is-visible': roomTotals }" data-series-mini="b" :aria-hidden="!roomTotals" :aria-label="`系列赢图 ${seriesScore('b')}`">{{ seriesScore('b') }}</span>
        <span class="win-stars" data-series-stars="b" :aria-label="state.seriesB === null ? '赢图未知' : `已赢 ${state.seriesB} 图`"><i v-for="n in view.meta.target" :key="n" v-emphasize="{ value: n <= (state.seriesB ?? 0), scope: `${motionScope}:${view.meta.target}`, enabled: motionReady && state.seriesB !== null, kind: 'pip' }" class="win-pip" :class="{ 'is-filled': n <= (state.seriesB ?? 0) }" aria-hidden="true"></i></span>
      </div>
    </section>
    <MapWinBanner v-if="!view.warmup" />
  </header>
</template>
