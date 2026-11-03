<script setup lang="ts">
import { vEmphasize } from '../motion';
import { useOverlay } from '../useOverlay';
import RosterFooter from './RosterFooter.vue';
const { state, view, motionScope } = useOverlay();
</script>
<template>
  <section class="scene" :inert="state.scene !== 'roll'" :aria-hidden="state.scene !== 'roll'" :class="{ 'is-active': state.scene === 'roll' }" data-scene-panel="roll" aria-label="Roll 与先手">
    <div class="scene-body roll-body">
      <span class="scene-eyebrow">ROLL / FIRST ACTION</span><h2>ROLL</h2>
      <div class="roll-sides">
        <div v-for="team in (['a', 'b'] as const)" :key="team" :data-team="team">
          <h3 :title="view.names[team]">{{ view.names[team] }}</h3>
          <strong v-emphasize="{ value: view.roll?.[team], scope: motionScope, enabled: state.scene === 'roll' }">{{ view.roll?.[team] ?? '—' }}</strong>
          <div class="roll-first-actions" v-emphasize="{ value: [state.pickFirst === team, state.banFirst === team], scope: motionScope, enabled: state.scene === 'roll' }">
            <span v-show="state.pickFirst === team" class="footer-kicker" data-first-action="pick">先 Pick</span>
            <span v-show="state.banFirst === team" class="footer-kicker" data-first-action="ban">先 Ban</span>
          </div>
        </div>
      </div>
      <p v-if="state.pickFirst === 'unknown' && state.banFirst === 'unknown'" class="roll-order-pending">先手待确认</p>
    </div>
    <RosterFooter />
  </section>
</template>
