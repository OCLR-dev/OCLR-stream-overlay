<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import { type Team } from '../model';
defineProps<{ team: Team }>();
const { view } = useOverlay();

type RosterPlayer = { id: string; name: string | null; osuId: number | null };
const displayName = (player: RosterPlayer) =>
  player.name?.trim() || (player.osuId != null ? String(player.osuId) : '未知');
const avatarUrl = (player: RosterPlayer) =>
  player.osuId != null ? `https://a.ppy.sh/${player.osuId}` : 'https://a.ppy.sh/';
const initial = (player: RosterPlayer) => displayName(player).slice(0, 1).toUpperCase();
const hideBroken = (event: Event) => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true;
};
</script>

<template>
  <div class="roster-grid" :style="{ '--roster-count': view.count }" :data-roster="team"
    :aria-label="`${view.names[team]} 上场选手 ${view.arrived(team) ? view.count : 0} / ${view.count} 已到场`">
    <article v-for="player in view.roster(team)" :key="player.id" class="player-card"
      :class="view.arrived(team) ? 'is-arrived' : 'is-waiting'" :data-team="team" :data-slot="player.slot"
      :data-player-id="player.id" :data-synthetic-ex="String(player.syntheticEx)"
      :data-arrival-state="view.arrived(team) ? 'arrived' : 'waiting'"
      :aria-label="`${view.names[team]}，${displayName(player)}${player.syntheticEx ? '，EX 后排示例' : ''}，${view.arrived(team) ? '已到场' : '等待中'}，${view.ready(team) ? '已就绪' : '就绪未确认'}`">
      <Transition name="player-swap" mode="out-in">
        <div class="player-identity" :key="`${player.osuId ?? 'anonymous'}:${displayName(player)}`">
          <div class="player-card-bg" aria-hidden="true">
            <span class="player-cover-fallback"></span>
            <img v-if="player.osuId != null" class="player-cover" :src="`/api/players/${player.osuId}/cover`" alt=""
              @error="hideBroken">
          </div>
          <span class="player-avatar player-avatar-fallback" aria-hidden="true">{{ initial(player) }}</span>
          <img class="player-avatar" :src="avatarUrl(player)"
            :alt="`${displayName(player)} 的 osu! 头像`" @error="hideBroken">
          <p class="player-name" :title="displayName(player)">{{ displayName(player) }}</p>
        </div>
      </Transition>
    </article>
  </div>
</template>
