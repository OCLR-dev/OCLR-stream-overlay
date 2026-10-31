<script setup lang="ts">
import { useOverlay } from '../useOverlay';
defineProps<{ result?: boolean; waiting?: boolean }>();
const { view } = useOverlay();
</script>

<template>
  <div class="playfield" :data-playfield="result || waiting ? undefined : ''" :data-result-playfield="result ? '' : undefined" :data-waiting-playfield="waiting ? '' : undefined"
    :aria-label="`${view.ex ? 'EX ' : ''}${view.count} 对 ${view.count}，${view.count * 2} 路${result ? '单图结算' : '上场选手游戏'}捕获区域`">
    <article v-for="player in view.players" :key="player.id" class="pov-cell" :data-team="player.team" :data-slot="player.slot" :data-player="player.id"
      :aria-label="`${view.names[player.team]} ${player.syntheticEx ? 'EX 后排示例 ' : ''}选手${player.id} ${player.role} ${result ? 'osu!原生结算' : '游戏'}捕获区域`">
      <div class="pov-frame">
        <div class="pov-source" :class="{ 'pov-source--result': result }" data-game-capture aria-hidden="true"></div>
      </div>
    </article>
  </div>
</template>
