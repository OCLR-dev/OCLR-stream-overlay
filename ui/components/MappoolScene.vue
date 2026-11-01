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
        <div class="mappool-team-status" data-team="a">
          <div class="mappool-team-heading">
            <span class="mappool-team-name" :title="view.names.a">{{ view.names.a }}</span>
            <span v-if="state.pickFirst === 'a' || state.banFirst === 'a'" class="mappool-first-actions">
              <span v-if="state.pickFirst === 'a'" class="mappool-first-action" data-first-action="pick">先 Pick</span>
              <span v-if="state.banFirst === 'a'" class="mappool-first-action" data-first-action="ban">先 Ban</span>
            </span>
          </div>
          <span class="ban-slot-chip" :data-state="banState('a', 0)"><span class="ban-slot-index">Ban 1</span><b data-ban-slot-view="a0">{{ view.banText('a', 0) }}</b></span>
          <span class="ban-slot-chip" :data-state="banState('a', 1)"><span class="ban-slot-index">Ban 2</span><b data-ban-slot-view="a1">{{ view.banText('a', 1) }}</b></span>
          <span class="ex-counter">EX 剩余 <b data-ex-remaining="a">{{ state.exA }}</b></span>
          <span v-if="view.ex && state.exTeam === 'a'" class="map-ex-mark" data-mappool-ex data-ex-team="a">EX 开启</span>
        </div>
        <div class="mappool-team-status mappool-team-status--b" data-team="b">
          <div class="mappool-team-heading">
            <span v-if="state.pickFirst === 'b' || state.banFirst === 'b'" class="mappool-first-actions">
              <span v-if="state.pickFirst === 'b'" class="mappool-first-action" data-first-action="pick">先 Pick</span>
              <span v-if="state.banFirst === 'b'" class="mappool-first-action" data-first-action="ban">先 Ban</span>
            </span>
            <span class="mappool-team-name" :title="view.names.b">{{ view.names.b }}</span>
          </div>
          <span v-if="view.ex && state.exTeam === 'b'" class="map-ex-mark" data-mappool-ex data-ex-team="b">EX 开启</span>
          <span class="ex-counter">EX 剩余 <b data-ex-remaining="b">{{ state.exB }}</b></span>
          <span class="ban-slot-chip" :data-state="banState('b', 0)"><span class="ban-slot-index">Ban 1</span><b data-ban-slot-view="b0">{{ view.banText('b', 0) }}</b></span>
          <span class="ban-slot-chip" :data-state="banState('b', 1)"><span class="ban-slot-index">Ban 2</span><b data-ban-slot-view="b1">{{ view.banText('b', 1) }}</b></span>
        </div>
      </div>

      <MapColumns />
    </div>

    <footer class="scene-footer chat-footer">
      <ChatPanel />
    </footer>
  </section>
</template>
