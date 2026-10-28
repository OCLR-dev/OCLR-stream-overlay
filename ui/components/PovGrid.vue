<script setup lang="ts">
import { useOverlay } from '../useOverlay';
defineProps<{ result?: boolean }>();
const { view } = useOverlay();
</script>

<template>
  <div class="playfield" :data-playfield="result ? undefined : ''" :data-result-playfield="result ? '' : undefined"
    :aria-label="`${view.ex ? 'EX ' : ''}${view.count} 对 ${view.count}，${view.count * 2} 路${result ? '单图结算' : '上场选手游戏'}画面占位`">
    <article v-for="player in view.players" :key="player.id" class="pov-cell" :data-team="player.team" :data-slot="player.slot" :data-player="player.id"
      :aria-label="`${view.names[player.team]} ${player.syntheticEx ? 'EX 后排示例 ' : ''}选手${player.id} ${player.role} ${result ? 'osu!原生结算' : '游戏'}画面占位`">
      <div class="pov-frame">
        <div class="pov-source" :class="{ 'pov-source--result': result }">
          <template v-if="view.shared"><span>等待游戏捕获接入</span></template>
          <template v-else-if="result">
            <span class="result-source-title">osu!原生结算画面</span>
            <span class="result-source-meta">Accuracy · Score · 100 · 50 · Miss</span>
          </template>
          <span v-else>游戏画面占位</span>
        </div>
      </div>
    </article>
  </div>
</template>
