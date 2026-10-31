<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import { type Team } from '../model';
defineProps<{ team: Team }>();
const { view } = useOverlay();
</script>

<template>
  <div class="roster-grid" :style="{ '--roster-count': view.count }" :data-roster="team" :aria-label="`${view.names[team]} 上场槽位 ${view.arrived(team) ? view.count : 0} / ${view.count} 已到场`">
    <article v-for="player in view.roster(team)" :key="player.id" class="player-card"
      :class="view.arrived(team) ? 'is-arrived' : 'is-waiting'" :data-team="team" :data-slot="player.slot"
      :data-player-id="player.id" :data-synthetic-ex="String(player.syntheticEx)" :data-arrival-state="view.arrived(team) ? 'arrived' : 'waiting'"
      :aria-label="`${view.names[team]}，${player.syntheticEx ? 'EX 后排示例 · ' : ''}选手${player.id}，${player.role}，${view.arrived(team) ? '已到场' : '等待中'}，就绪未确认`">
      <div class="player-card-top">
        <span class="player-slot">{{ player.id }} / SLOT {{ String(player.slot).padStart(2, '0') }}</span>
        <span class="arrival-chip" aria-hidden="true">{{ view.arrived(team) ? '✓ 已到场' : '◇ 等待中' }}</span>
      </div>
      <div class="player-main">
        <div class="player-copy">
          <p class="player-name">{{ player.name || (view.shared ? '名单待设置' : `选手${player.id}`) }}<span v-if="player.role" class="role-chip">{{ player.role }}</span></p>
          <p class="player-sub">{{ view.names[team] }} · {{ player.syntheticEx ? 'EX 后排示例 · ' : '' }}本场上场位 {{ player.slot }} / {{ view.count }}</p>
        </div>
      </div>
      <div class="player-bottom">
        <div class="player-status"><span>到场状态</span><strong>{{ view.arrived(team) ? '已到场' : '等待中' }}</strong></div>
        <div class="player-status"><span>就绪状态</span><strong>{{ view.ready(team) ? '已就绪' : '未确认' }}</strong></div>
      </div>
    </article>
  </div>
</template>
