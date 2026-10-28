<script setup lang="ts">
import { useOverlay } from '../useOverlay';
import PlayerRoster from './PlayerRoster.vue';

const { state, view } = useOverlay();
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'waiting' }" :hidden="state.scene !== 'waiting'" data-scene-panel="waiting" aria-labelledby="waiting-title">
    <div class="scene-body waiting-body">
      <div class="waiting-head">
        <div class="title-line">
          <span class="scene-eyebrow">PRE-MATCH / 01</span>
          <h2 id="waiting-title">等待选手</h2>
          <span class="state-badge">未就绪</span>
        </div>
      </div>

      <div class="waiting-main">
        <section class="team-roster" data-team-panel="a" aria-label="示例A队在场槽位">
          <header class="roster-head">
            <span class="roster-team"><strong>示例A队</strong></span>
            <span class="roster-count" data-arrival-count="a">{{ `${view.arrived('a') ? view.count : 0} / ${view.count} 已到场` }}</span>
          </header>
          <PlayerRoster team="a" />
        </section>

        <aside class="readiness-column" aria-label="对阵与就绪状态">
          <div class="versus-bar">
            <span>示例A队</span>
            <b>VS</b>
            <span>示例B队</span>
          </div>
          <div class="readiness-card" aria-live="polite">
            <span class="readiness-kicker">到场 / 就绪</span>
            <p class="readiness-headline" id="readinessHeadline">{{ view.readiness }}</p>
            <p class="readiness-count"><strong id="readinessCount">{{ `${view.arrivalCount} / ${view.count * 2}` }}</strong><span>人已到场</span></p>
            <p class="readiness-copy" id="readinessCopy">{{ view.readinessCopy }}</p>
            <div class="readiness-state">
              <span>就绪</span>
              <span class="state-badge">未确认</span>
            </div>
          </div>
        </aside>

        <section class="team-roster" data-team-panel="b" aria-label="示例B队在场槽位">
          <header class="roster-head">
            <span class="roster-team"><strong>示例B队</strong></span>
            <span class="roster-count" data-arrival-count="b">{{ `${view.arrived('b') ? view.count : 0} / ${view.count} 已到场` }}</span>
          </header>
          <PlayerRoster team="b" />
        </section>
      </div>
    </div>

    <footer class="scene-footer waiting-footer">
      <section class="footer-cell">
        <span class="footer-kicker">现场解说</span>
        <p data-waiting-commentary>{{ view.commentary }}</p>
      </section>
      <section class="footer-cell footer-cell--lead">
        <span class="footer-kicker">当前阶段</span>
        <p class="footer-lead">等待选手</p>
      </section>
      <section class="footer-cell">
        <span class="footer-kicker">本场对阵</span>
        <p>示例A队 <span class="versus-inline">vs</span> 示例B队</p>
      </section>
    </footer>
  </section>
</template>
