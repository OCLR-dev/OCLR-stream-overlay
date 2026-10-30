<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import MapColumns from './MapColumns.vue';
import ChatPanel from './ChatPanel.vue';

const { state, view } = useOverlay();
const banState = (team: 'a' | 'b', index: 0 | 1) => view.value.shared
  ? view.value.banText(team, index) === '未确认' ? 'unknown' : 'used'
  : state.banSlots[team][index] === 'empty' ? 'empty' : state.banSlots[team][index] === 'unknown' ? 'unknown' : 'used';
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'mappool' }" :inert="state.scene !== 'mappool'" :aria-hidden="state.scene !== 'mappool'" data-scene-panel="mappool" aria-labelledby="mappool-title">
    <div class="scene-body mappool-body">
      <div class="scene-head mappool-head">
        <div class="title-line">
          <span class="scene-eyebrow">BAN / PICK · 02</span>
          <h2 id="mappool-title">MAPPOOL</h2>
        </div>
      </div>

      <div class="mappool-status" aria-label="本场选图状态">
        <div class="mappool-team-status">
          <span class="mappool-team-name">{{ view.names.a }}</span>
          <span class="ban-slot-chip" :data-state="banState('a', 0)"><span class="ban-slot-index">Ban 1</span><b data-ban-slot-view="a0">{{ view.banText('a', 0) }}</b></span>
          <span class="ban-slot-chip" :data-state="banState('a', 1)"><span class="ban-slot-index">Ban 2</span><b data-ban-slot-view="a1">{{ view.banText('a', 1) }}</b></span>
          <span class="ex-counter">EX 剩余 <b data-ex-remaining="a">{{ state.exA }}</b></span>
        </div>
        <div class="mappool-mid">
          <span>先Pick <b data-pick-first>{{ view.orderLabel(state.pickFirst) }}</b></span>
          <span>先Ban <b data-ban-first>{{ view.orderLabel(state.banFirst) }}</b></span>
          <span>当前 <b data-mappool-format>{{ view.formatLabel }}</b> · <b data-mappool-mod>{{ view.mod }}</b></span>
          <span class="map-ex-mark" data-mappool-ex :data-ex-team="view.ex ? state.exTeam : undefined">{{ view.exLabel }}</span>
        </div>
        <div class="mappool-team-status mappool-team-status--b">
          <span class="mappool-team-name">{{ view.names.b }}</span>
          <span class="ban-slot-chip" :data-state="banState('b', 0)"><span class="ban-slot-index">Ban 1</span><b data-ban-slot-view="b0">{{ view.banText('b', 0) }}</b></span>
          <span class="ban-slot-chip" :data-state="banState('b', 1)"><span class="ban-slot-index">Ban 2</span><b data-ban-slot-view="b1">{{ view.banText('b', 1) }}</b></span>
          <span class="ex-counter">EX 剩余 <b data-ex-remaining="b">{{ state.exB }}</b></span>
        </div>
      </div>

      <MapColumns />
    </div>

    <footer class="scene-footer chat-footer">
      <ChatPanel />
    </footer>
  </section>
</template>
