<script setup lang="ts">
import { useOverlay } from '../useOverlay';
defineProps<{ waiting?: boolean }>();
const { view } = useOverlay();
</script>

<template>
  <div class="playfield" :data-playfield="waiting ? undefined : ''" :data-waiting-playfield="waiting ? '' : undefined"
    :aria-label="`${view.ex ? 'EX ' : ''}${view.count} 对 ${view.count}，${view.count * 2} 路上场选手游戏捕获区域`">
    <article v-for="player in view.players" :key="player.id" class="pov-cell" :data-team="player.team" :data-slot="player.slot" :data-player="player.id"
      :aria-label="`${view.names[player.team]} ${player.syntheticEx ? 'EX 后排示例 ' : ''}选手${player.id} ${player.role} 游戏捕获区域`">
      <div class="pov-frame">
        <div class="pov-source" data-game-capture aria-hidden="true"></div>
      </div>
    </article>
  </div>
</template>
