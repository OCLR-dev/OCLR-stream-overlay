<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { latestAutoWinAward, shortenWinTeamName } from '../autoWinAward';
import type { Team } from '../model';
import { useOverlay } from '../useOverlay';
import TeamFlagPreview from './TeamFlagPreview.vue';

const { session, view, motionScope } = useOverlay();
const DURATION = 5000;

interface Banner {
  sequence: number;
  team: Team;
  name: string;
}

const banner = ref<Banner | null>(null);
let sequence = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let baselineScope: string | null = null;
let lastAwardId: string | null = null;

const show = (team: Team) => {
  sequence += 1;
  banner.value = { sequence, team, name: shortenWinTeamName(view.value.names[team]) };
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { banner.value = null; }, DURATION);
};

// Establish a silent baseline after load, reconnect or a new match. Only an
// award that arrives while this overlay is live may start the celebration.
watch([session, motionScope], ([current, currentScope]) => {
  if (!current) return;
  const award = latestAutoWinAward(current);
  if (baselineScope !== currentScope) {
    const previousScope = baselineScope;
    baselineScope = currentScope;
    lastAwardId = award?.id ?? null;
    // A reconnect may reveal an award that happened while this output was
    // offline. It is history, not a live event: drop any stale sweep and
    // re-baseline without replaying it.
    if (previousScope !== null) {
      clearTimeout(hideTimer);
      banner.value = null;
    }
    return;
  }
  if (!award || award.id === lastAwardId) return;
  lastAwardId = award.id;
  show(award.team);
}, { immediate: true });

onUnmounted(() => clearTimeout(hideTimer));
</script>

<template>
  <div v-if="banner" class="map-win-layer" aria-hidden="true">
    <div :key="banner.sequence" class="map-win-banner" :data-team="banner.team" data-map-win-banner>
      <div class="map-win-copy">
        <strong class="map-win-name">{{ banner.name }}</strong>
        <span class="map-win-suffix">赢得本图</span>
      </div>
      <TeamFlagPreview class="map-win-flag" :team="banner.team" decorative />
    </div>
  </div>
</template>
