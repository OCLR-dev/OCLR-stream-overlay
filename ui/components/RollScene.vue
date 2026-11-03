<script setup lang="ts">
import { vEmphasize } from '../motion';
import { useOverlay } from '../useOverlay';
const { state, view, motionScope } = useOverlay();
</script>
<template>
  <section class="scene" :inert="state.scene !== 'roll'" :aria-hidden="state.scene !== 'roll'" :class="{ 'is-active': state.scene === 'roll' }" data-scene-panel="roll" aria-label="Roll 与先手">
    <div class="scene-body roll-body">
      <span class="scene-eyebrow">ROLL / FIRST ACTION</span><h2>ROLL</h2>
      <div class="roll-sides"><div v-for="team in (['a', 'b'] as const)" :key="team" :data-team="team"><h3 :title="view.names[team]">{{ view.names[team] }}</h3><strong v-emphasize="{ value: view.roll?.[team], scope: motionScope, enabled: state.scene === 'roll' }">{{ view.roll?.[team] ?? '—' }}</strong></div></div>
    </div>
    <footer class="scene-footer roll-footer">
      <div class="footer-cell roll-order" role="group" aria-label="先 Pick 与先 Ban">
        <div v-for="team in (['a', 'b'] as const)" :key="team" class="roll-order-row" :data-team="team">
          <div class="roll-first-actions" v-emphasize="{ value: [state.pickFirst === team, state.banFirst === team], scope: motionScope, enabled: state.scene === 'roll' }">
            <span v-show="state.pickFirst === team" class="footer-kicker" data-first-action="pick">先 Pick</span>
            <span v-show="state.banFirst === team" class="footer-kicker" data-first-action="ban">先 Ban</span>
            <span v-if="state.pickFirst === 'unknown' && state.banFirst === 'unknown'" class="roll-order-pending">先手待确认</span>
          </div>
          <p :title="view.names[team]" :data-team="team">{{ view.names[team] }}</p>
        </div>
      </div>
    </footer>
  </section>
</template>
