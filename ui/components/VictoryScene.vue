<script setup lang="ts">
import { computed } from 'vue';
import { vEmphasize } from '../motion';
import { useOverlay } from '../useOverlay';
import { modColorStyle } from '../modColors';
import TeamFlag from './TeamFlag.vue';
import {
  dualRosterDensity,
  heroRosterDensity,
  realRosterMembers,
  recapStripDensity,
  winnerHeadlineTier,
  type VictoryRecapItem,
} from '../victoryDisplay';
import type { RosterMember, Team } from '../model';

const { state, view, session, motionScope } = useOverlay();

const rosterSlot = (player: RosterMember) => `#${player.slot}`;
const displayName = (player: RosterMember) =>
  player.name?.trim() || (player.osuId != null ? String(player.osuId) : '未知');
const avatarUrl = (player: RosterMember) =>
  player.osuId != null ? `https://a.ppy.sh/${player.osuId}` : 'https://a.ppy.sh/';
const initial = (player: RosterMember) => displayName(player).slice(0, 1).toUpperCase();
const hideBroken = (event: Event) => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true;
};

const teamRoster = (team: Team) => realRosterMembers(view.value.fullRoster(team), view.value.hasRoster(team));
const winnerRoster = computed(() => (view.value.winnerTeam ? teamRoster(view.value.winnerTeam) : []));
const heroDensity = computed(() => heroRosterDensity(winnerRoster.value.length));
const dualHasAnyRoster = computed(() => teamRoster('a').length > 0 || teamRoster('b').length > 0);
const dualDensity = (team: Team) => dualRosterDensity(teamRoster(team).length);

const hasDisplayRoster = computed(() =>
  view.value.winnerTeam ? winnerRoster.value.length > 0 : dualHasAnyRoster.value
);

const winnerTeamData = computed(() => {
  const team = view.value.winnerTeam;
  return team && session.value ? session.value.match.teams[team] : null;
});

const sceneTitle = computed(() => {
  if (view.value.drawnExhibition) return '全场平局';
  if (view.value.winnerTeam && view.value.isChampionship) return '全场冠军';
  if (view.value.winnerTeam) return '全场胜利';
  return '全场结算';
});

const heroMark = computed(() => {
  if (view.value.drawnExhibition) return 'DRAW';
  if (view.value.isChampionship && view.value.winnerTeam) return 'CHAMPION';
  return view.value.winnerTeam ? 'WINNER' : 'PENDING';
});

const winnerTitleSize = computed(() => winnerHeadlineTier(view.value.winner || '全场胜者待确认'));
const recapDensity = computed(() => recapStripDensity(view.value.recapRounds.length));

const recapTooltip = (item: VictoryRecapItem) => {
  const pickText = item.pickedBy ? `${view.value.names[item.pickedBy]} Pick` : '决胜图 TB';
  const winText = item.winner ? `${view.value.names[item.winner]} 胜` : '本图平局';
  const exText = item.exTeam ? ` · EX（${view.value.names[item.exTeam]}）` : '';
  const margin = item.marginText ? ` · 分差 ${item.marginText}` : '';
  const mapTitle = item.title ? ` · ${item.title}` : '';
  return `#${item.order} ${item.label}${mapTitle}｜${pickText} → ${winText}${exText}${margin}`;
};

const banSummary = (team: Team) => {
  const items = ([0, 1] as const)
    .map(idx => view.value.banText(team, idx))
    .filter(label => label && label !== '未确认');
  return items.length ? items.join(' / ') : '未记录';
};

const orderSummary = (team: Team) => {
  const tags: string[] = [];
  if (state.pickFirst === team) tags.push('先选');
  if (state.banFirst === team) tags.push('先禁');
  return tags.length ? tags.join(' · ') : '';
};
</script>

<template>
  <section
    class="scene victory-scene"
    :class="{ 'is-active': state.scene === 'victory' }"
    :inert="state.scene !== 'victory'"
    :aria-hidden="state.scene !== 'victory'"
    data-scene-panel="victory"
    aria-labelledby="victory-title"
  >
    <div class="scene-head victory-head">
      <div class="title-line">
        <span class="scene-eyebrow">{{ view.seriesTarget }}</span>
        <h2 id="victory-title">{{ sceneTitle }}</h2>
      </div>
    </div>

    <div
      class="scene-body victory-body victory-stage"
      :data-winner-side="view.winnerTeam || (view.drawnExhibition ? 'draw' : 'pending')"
      :data-championship="view.isChampionship ? '1' : '0'"
      :data-has-roster="hasDisplayRoster ? '1' : '0'"
    >
      <!-- Mode A: Confirmed Winner Hero Stage + Full Winning Squad -->
      <template v-if="view.winnerTeam">
        <div class="victory-hero victory-hero--crowned">
          <div class="victory-kicker-row">
            <span class="victory-kicker-line" aria-hidden="true"></span>
            <span class="victory-kicker">
              {{ view.brand }} · <span data-victory-stage>{{ view.meta.label }}</span>
            </span>
            <span v-if="view.isChampionship" class="victory-grand-badge">GRAND FINAL</span>
            <span class="victory-kicker-line" aria-hidden="true"></span>
          </div>

          <div
            class="victory-mark"
            :data-mark-kind="view.isChampionship ? 'champion' : 'winner'"
            aria-hidden="true"
          >
            {{ heroMark }}
          </div>

          <div
            class="victory-copy victory-copy--winner"
            v-emphasize="{ value: [view.winnerTeam, view.winner], scope: motionScope, enabled: state.scene === 'victory', kind: 'winner' }"
          >
            <div class="victory-winner-lockup" :data-team="view.winnerTeam">
              <TeamFlag class="victory-winner-flag" :team="winnerTeamData" :name="view.winner || ''" />
              <div class="victory-winner-heading">
                <span class="victory-team-kicker" :data-team="view.winnerTeam">
                  {{ view.winnerTeam === 'a' ? 'RED TEAM' : 'BLUE TEAM' }} · {{ view.isChampionship ? 'TOURNAMENT CHAMPION' : 'SERIES WINNER' }}
                </span>
                <h3 class="victory-team-title" :data-size="winnerTitleSize" :title="view.winner || ''">
                  {{ view.winner }}
                </h3>
              </div>
            </div>
          </div>

          <div v-if="!view.warmup" class="victory-result victory-scoreboard" data-victory-scoreboard>
            <div
              class="scoreboard-side scoreboard-side--a"
              :class="{ 'is-winner': view.winnerTeam === 'a', 'is-loser': view.winnerTeam === 'b' }"
            >
              <span class="scoreboard-team" :title="view.names.a">{{ view.names.a }}</span>
              <strong class="scoreboard-num">{{ view.series.a ?? '—' }}</strong>
            </div>
            <div class="scoreboard-center" aria-hidden="true">
              <span class="scoreboard-tag">FINAL</span>
              <i class="scoreboard-colon">:</i>
            </div>
            <div
              class="scoreboard-side scoreboard-side--b"
              :class="{ 'is-winner': view.winnerTeam === 'b', 'is-loser': view.winnerTeam === 'a' }"
            >
              <strong class="scoreboard-num">{{ view.series.b ?? '—' }}</strong>
              <span class="scoreboard-team" :title="view.names.b">{{ view.names.b }}</span>
            </div>
          </div>
        </div>

        <section
          v-if="winnerRoster.length"
          class="victory-roster-showcase"
          :data-team="view.winnerTeam"
          data-victory-roster
          :aria-label="`${view.winner} ${view.isChampionship ? '冠军' : '获胜'}队伍名单`"
        >
          <header class="victory-roster-bar">
            <span class="victory-roster-title">
              {{ view.isChampionship ? 'CHAMPION ROSTER · 冠军阵容' : 'WINNING ROSTER · 获胜阵容' }}
            </span>
            <span class="victory-roster-rule" aria-hidden="true"></span>
            <span class="victory-roster-count">共 {{ winnerRoster.length }} 名队员</span>
          </header>

          <div
            class="victory-roster-grid"
            :data-hero-density="heroDensity"
            :data-count="winnerRoster.length"
            :style="{ '--hero-cols': Math.min(winnerRoster.length, 6) }"
          >
            <article
              v-for="player in winnerRoster"
              :key="player.id"
              class="victory-player-card"
              :data-team="view.winnerTeam"
              :data-slot="player.slot"
              :data-player-id="player.id"
              :aria-label="`${view.winner}，${displayName(player)}`"
            >
              <div class="player-card-bg" aria-hidden="true">
                <span class="player-cover-fallback"></span>
                <img
                  v-if="player.osuId != null"
                  class="player-cover"
                  :src="`/api/players/${player.osuId}/cover`"
                  alt=""
                  @error="hideBroken"
                >
              </div>
              <div class="victory-player-inner">
                <div class="victory-player-meta">
                  <span v-if="view.rosterSlots" class="victory-player-slot">{{ rosterSlot(player) }}</span>
                  <span v-if="player.osuId != null" class="victory-player-uid">UID {{ player.osuId }}</span>
                </div>
                <div class="victory-avatar-shell">
                  <span class="player-avatar player-avatar-fallback" aria-hidden="true">{{ initial(player) }}</span>
                  <img
                    v-if="player.osuId != null"
                    class="player-avatar"
                    :src="avatarUrl(player)"
                    :alt="`${displayName(player)} 的 osu! 头像`"
                    @error="hideBroken"
                  >
                </div>
                <div class="victory-player-plate">
                  <p class="victory-player-name" :title="displayName(player)">{{ displayName(player) }}</p>
                </div>
              </div>
            </article>
          </div>
        </section>
      </template>

      <!-- Mode B: Symmetrical Dual-Team Stage for Exhibition Draw or Pending Confirmation -->
      <template v-else>
        <div class="victory-hero victory-hero--symmetrical">
          <div class="victory-kicker-row">
            <span class="victory-kicker-line" aria-hidden="true"></span>
            <span class="victory-kicker">
              {{ view.brand }} · <span data-victory-stage>{{ view.meta.label }}</span>
            </span>
            <span v-if="view.isChampionship" class="victory-grand-badge">GRAND FINAL</span>
            <span class="victory-kicker-line" aria-hidden="true"></span>
          </div>

          <div
            class="victory-mark"
            :data-mark-kind="view.drawnExhibition ? 'draw' : 'pending'"
            aria-hidden="true"
          >
            {{ heroMark }}
          </div>

          <div
            class="victory-copy victory-copy--symmetrical"
            v-emphasize="{ value: [view.drawnExhibition, view.winner], scope: motionScope, enabled: state.scene === 'victory', kind: 'winner' }"
          >
            <h3 class="victory-team-title" data-size="lg">
              {{ view.drawnExhibition ? '表演赛平局' : '全场胜者待确认' }}
            </h3>
          </div>

          <div v-if="!view.warmup" class="victory-result victory-scoreboard is-symmetrical" data-victory-scoreboard>
            <div class="scoreboard-side scoreboard-side--a">
              <span class="scoreboard-team" :title="view.names.a">{{ view.names.a }}</span>
              <strong class="scoreboard-num">{{ view.series.a ?? '—' }}</strong>
            </div>
            <div class="scoreboard-center" aria-hidden="true">
              <span class="scoreboard-tag">{{ view.drawnExhibition ? 'TIED' : 'VS' }}</span>
              <i class="scoreboard-colon">:</i>
            </div>
            <div class="scoreboard-side scoreboard-side--b">
              <strong class="scoreboard-num">{{ view.series.b ?? '—' }}</strong>
              <span class="scoreboard-team" :title="view.names.b">{{ view.names.b }}</span>
            </div>
          </div>
        </div>

        <div v-if="dualHasAnyRoster" class="victory-dual-rosters" data-victory-dual-rosters>
          <section
            v-for="team in (['a', 'b'] as const)"
            :key="team"
            class="victory-dual-panel"
            :data-team="team"
            :aria-label="`${view.names[team]} 队伍名单`"
          >
            <header class="victory-dual-head">
              <div class="victory-dual-team">
                <span class="roster-side-kicker">{{ team === 'a' ? 'RED TEAM' : 'BLUE TEAM' }}</span>
                <strong :title="view.names[team]">{{ view.names[team] }}</strong>
              </div>
              <span class="roster-count">
                {{ teamRoster(team).length ? `${teamRoster(team).length} 名队员` : '名单未录入' }}
              </span>
            </header>

            <div
              v-if="teamRoster(team).length"
              class="victory-dual-grid"
              :data-dual-density="dualDensity(team)"
              :data-count="teamRoster(team).length"
            >
              <article
                v-for="player in teamRoster(team)"
                :key="player.id"
                class="victory-dual-card"
                :data-team="team"
                :data-slot="player.slot"
              >
                <div class="player-card-bg" aria-hidden="true">
                  <span class="player-cover-fallback"></span>
                  <img
                    v-if="player.osuId != null"
                    class="player-cover"
                    :src="`/api/players/${player.osuId}/cover`"
                    alt=""
                    @error="hideBroken"
                  >
                </div>
                <div class="victory-dual-identity">
                  <div class="victory-dual-avatar">
                    <span class="player-avatar player-avatar-fallback" aria-hidden="true">{{ initial(player) }}</span>
                    <img
                      v-if="player.osuId != null"
                      class="player-avatar"
                      :src="avatarUrl(player)"
                      :alt="`${displayName(player)} 的 osu! 头像`"
                      @error="hideBroken"
                    >
                  </div>
                  <div class="victory-dual-copy">
                    <div class="victory-player-meta">
                      <span v-if="view.rosterSlots" class="victory-player-slot">{{ rosterSlot(player) }}</span>
                      <span v-if="player.osuId != null" class="victory-player-uid">UID {{ player.osuId }}</span>
                    </div>
                    <p class="victory-dual-name" :title="displayName(player)">{{ displayName(player) }}</p>
                  </div>
                </div>
              </article>
            </div>
            <div v-else class="victory-dual-empty">
              <span>本场未录入该队选手名单</span>
            </div>
          </section>
        </div>
      </template>
    </div>

    <footer
      class="scene-footer victory-footer"
      :data-winner-side="view.winnerTeam || (view.drawnExhibition ? 'draw' : 'pending')"
      aria-label="本场对局战报"
    >
      <div class="victory-recap-card" data-victory-recap>
        <template v-if="view.recapRounds.length">
          <div class="victory-recap-head">
            <div class="victory-recap-title-group">
              <span class="victory-recap-kicker">MATCH RECAP · 本场逐图战报</span>
              <strong class="victory-recap-sub">共 {{ view.recapRounds.length }} 局赛果</strong>
            </div>
            <div class="victory-recap-badges">
              <span v-if="!view.exhibition && banSummary('a') !== '未记录'" class="victory-recap-pill" data-team="a">
                红禁 {{ banSummary('a') }}
              </span>
              <span v-if="!view.exhibition && banSummary('b') !== '未记录'" class="victory-recap-pill" data-team="b">
                蓝禁 {{ banSummary('b') }}
              </span>
              <span v-if="view.hasSeriesAdjustment" class="victory-recap-pill is-subtle">含比分校正</span>
              <span v-if="!view.shared" class="victory-recap-pill is-subtle">演示示意</span>
            </div>
          </div>

          <div
            class="victory-recap-strip"
            :data-recap-density="recapDensity"
            :style="{ '--recap-cols': Math.min(view.recapRounds.length, 13) }"
          >
            <div
              v-for="item in view.recapRounds"
              :key="item.id"
              class="victory-recap-item"
              :data-mod="item.mod"
              :data-winner="item.winner || 'draw'"
              :data-pick="item.pickedBy || 'tb'"
              :data-break="item.isBreak ? '1' : '0'"
              :style="modColorStyle(item.mod)"
              :title="recapTooltip(item)"
            >
              <div class="recap-item-top">
                <strong class="recap-slot">{{ item.label }}</strong>
                <span v-if="item.exTeam && recapDensity !== 'dense'" class="recap-ex-tag" :data-team="item.exTeam">EX</span>
                <span
                  v-else-if="recapDensity === 'spacious'"
                  class="recap-pick-tag"
                  :data-team="item.pickedBy || 'tb'"
                >
                  {{ item.pickedBy === 'a' ? '红选' : item.pickedBy === 'b' ? '蓝选' : 'TB' }}
                </span>
              </div>

              <span v-if="recapDensity === 'spacious'" class="recap-item-mid">
                {{ item.marginText || (item.isBreak ? '破发得分' : '') }}
              </span>
              <span
                v-else-if="recapDensity === 'compact'"
                class="recap-pick-tag is-row"
                :data-team="item.pickedBy || 'tb'"
              >
                {{ item.pickedBy === 'a' ? '红选' : item.pickedBy === 'b' ? '蓝选' : '决胜' }}
              </span>

              <span class="recap-win-bar" :data-winner="item.winner || 'draw'">
                {{ item.winner === 'a' ? ((recapDensity === 'ultra' || recapDensity === 'dense') ? '红' : '红胜') : item.winner === 'b' ? ((recapDensity === 'ultra' || recapDensity === 'dense') ? '蓝' : '蓝胜') : '平局' }}
              </span>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="victory-recap-head">
            <div class="victory-recap-title-group">
              <span class="victory-recap-kicker">SERIES SUMMARY · 本场对局概览</span>
              <strong class="victory-recap-sub" :title="view.poolName">{{ view.poolName }}</strong>
            </div>
            <div class="victory-recap-badges">
              <span v-if="view.hasSeriesAdjustment" class="victory-recap-pill is-subtle">比分直接记录</span>
              <span class="victory-recap-pill is-subtle">{{ view.seriesTarget }}</span>
            </div>
          </div>

          <div class="victory-summary-grid">
            <div class="victory-summary-cell">
              <span class="summary-label">比赛阶段</span>
              <strong class="summary-value">
                {{ view.meta.label }}{{ view.isChampionship ? ' · GRAND FINAL' : '' }}
              </strong>
            </div>
            <div class="victory-summary-cell">
              <span class="summary-label">对阵模式</span>
              <strong class="summary-value">{{ state.mode }} · {{ view.seriesTarget }}</strong>
            </div>
            <div class="victory-summary-cell" data-team="a">
              <span class="summary-label">红队先手与禁用</span>
              <strong class="summary-value" :title="`${orderSummary('a')} ${banSummary('a')}`.trim()">
                {{ [orderSummary('a'), view.exhibition ? '' : `禁 ${banSummary('a')}`].filter(Boolean).join(' · ') || '未记录' }}
              </strong>
            </div>
            <div class="victory-summary-cell" data-team="b">
              <span class="summary-label">蓝队先手与禁用</span>
              <strong class="summary-value" :title="`${orderSummary('b')} ${banSummary('b')}`.trim()">
                {{ [orderSummary('b'), view.exhibition ? '' : `禁 ${banSummary('b')}`].filter(Boolean).join(' · ') || '未记录' }}
              </strong>
            </div>
          </div>
        </template>
      </div>
    </footer>
  </section>
</template>
