<script setup lang="ts">
import { computed } from 'vue';
import { useOverlay } from '../useOverlay';
import { modColorStyle } from '../modColors';
import type { RosterMember, Team } from '../model';

const { state, view } = useOverlay();

const displayName = (player: RosterMember) =>
  player.placeholder ? '阵容待公布' : player.name?.trim() || (player.osuId != null ? String(player.osuId) : '未知');
const avatarUrl = (player: RosterMember) =>
  player.osuId != null ? `https://a.ppy.sh/${player.osuId}` : 'https://a.ppy.sh/';
const initial = (player: RosterMember) =>
  player.placeholder ? String(player.slot) : displayName(player).slice(0, 1).toUpperCase();
const hideBroken = (event: Event) => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true;
};

const teamStatus = (team: Team) =>
  view.value.ready(team) ? 'ready' : view.value.arrived(team) ? 'arrived' : 'waiting';
const teamStatusLabel = (team: Team) =>
  view.value.ready(team) ? '已就绪' : view.value.arrived(team) ? '已到场' : '等待到场';

const rosterDensity = (total: number) => {
  if (total <= 4) return 'hero';
  if (total <= 6) return 'standard';
  if (total <= 8) return 'compact';
  if (total <= 12) return 'dense';
  return 'ultra';
};

const rollSummary = computed(() => {
  const { pickFirst, banFirst } = state;
  if (pickFirst !== 'unknown' && banFirst !== 'unknown') {
    return view.value.exhibition
      ? `先选 · ${view.value.orderLabel(pickFirst)}`
      : `先选 ${view.value.orderLabel(pickFirst)} · 先禁 ${view.value.orderLabel(banFirst)}`;
  }
  if (pickFirst !== 'unknown') return `先选 · ${view.value.orderLabel(pickFirst)}`;
  if (banFirst !== 'unknown') return `先禁 · ${view.value.orderLabel(banFirst)}`;
  const roll = view.value.roll;
  if (roll && (roll.a != null || roll.b != null)) return `Roll ${roll.a ?? '—'} : ${roll.b ?? '—'}`;
  return '待双方就绪后 Roll 点';
});

const modOrder = ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'];
const poolGroups = computed(() => {
  const buckets = new Map<string, string[]>();
  for (const entry of view.value.pool) {
    const list = buckets.get(entry.mod) || [];
    list.push(entry.label || entry.mod);
    buckets.set(entry.mod, list);
  }
  const ordered = [
    ...modOrder.filter(mod => buckets.has(mod)),
    ...[...buckets.keys()].filter(mod => !modOrder.includes(mod)),
  ];
  return ordered.map(mod => {
    const labels = buckets.get(mod) || [];
    const range = mod === 'TB'
      ? (labels.length === 1 ? `${labels[0]} · 决胜图` : `${labels[0]} – ${labels[labels.length - 1]}`)
      : labels.length === 1
        ? labels[0]!
        : `${labels[0]} – ${labels[labels.length - 1]}`;
    return { mod, count: labels.length, labels, range };
  });
});
</script>

<template>
  <section class="scene" :class="{ 'is-active': state.scene === 'waiting' }" :inert="state.scene !== 'waiting'"
    :aria-hidden="state.scene !== 'waiting'" data-scene-panel="waiting" aria-label="等待选手">
    <div class="scene-head waiting-head">
      <div class="title-line">
        <span class="scene-eyebrow">{{ view.meta.format }}</span>
        <h2>等待</h2>
      </div>
    </div>

    <div class="scene-body waiting-body">
      <div class="waiting-main">
        <section class="team-roster" data-team-panel="a" :aria-label="`${view.names.a} 队伍完整名单`">
          <header class="roster-head">
            <div class="roster-team">
              <span class="roster-side-kicker">RED TEAM</span>
              <strong :title="view.names.a">{{ view.names.a }}</strong>
            </div>
            <div class="roster-head-meta">
              <span class="roster-count">{{ view.hasRoster('a') ? `${view.fullRoster('a').length} 名队员` : `名单待核对 · ${state.mode}` }}</span>
              <span class="roster-status-pill" :data-status="teamStatus('a')">{{ teamStatusLabel('a') }}</span>
            </div>
          </header>
          <div class="waiting-roster-grid" :data-density="rosterDensity(view.fullRoster('a').length)"
            :data-count="view.fullRoster('a').length" data-roster="a">
            <article v-for="player in view.fullRoster('a')" :key="player.id" class="waiting-player-card"
              :class="[view.arrived('a') ? 'is-arrived' : 'is-waiting', { 'is-placeholder': player.placeholder }]"
              data-team="a" :data-slot="player.slot" :data-player-id="player.id"
              :data-arrival-state="view.arrived('a') ? 'arrived' : 'waiting'"
              :aria-label="`${view.names.a}，${displayName(player)}，#${player.slot}，${teamStatusLabel('a')}`">
              <Transition name="player-swap" mode="out-in">
                <div class="waiting-player-identity" :key="`${player.osuId ?? 'anonymous'}:${displayName(player)}`">
                  <div class="player-card-bg" aria-hidden="true">
                    <span class="player-cover-fallback"></span>
                    <img v-if="player.osuId != null" class="player-cover" :src="`/api/players/${player.osuId}/cover`" alt=""
                      @error="hideBroken">
                  </div>
                  <div class="waiting-avatar-shell">
                    <span class="player-avatar player-avatar-fallback" aria-hidden="true">{{ initial(player) }}</span>
                    <img v-if="!player.placeholder" class="player-avatar" :src="avatarUrl(player)"
                      :alt="`${displayName(player)} 的 osu! 头像`" @error="hideBroken">
                  </div>
                  <div class="waiting-player-copy">
                    <div class="waiting-player-meta">
                      <span class="waiting-player-slot">#{{ String(player.slot).padStart(2, '0') }}</span>
                      <span v-if="player.osuId != null" class="waiting-player-uid">UID {{ player.osuId }}</span>
                      <span v-else-if="player.placeholder" class="waiting-player-uid is-muted">待录入</span>
                    </div>
                    <p class="waiting-player-name" :title="displayName(player)">{{ displayName(player) }}</p>
                  </div>
                </div>
              </Transition>
            </article>
          </div>
        </section>

        <aside class="readiness-column" aria-label="赛前对阵与就绪信息">
          <div class="versus-bar">
            <span class="waiting-event-kicker" :title="view.title">{{ view.title }}</span>
            <b>VS</b>
            <span class="waiting-readiness-pill" :data-ready="view.ready('a') && view.ready('b')">
              {{ view.warmup ? 'WARM-UP · 热身模式' : view.readiness }}
            </span>
          </div>

          <section class="waiting-specs-card" aria-label="本场赛制规格">
            <div class="waiting-card-head">
              <span class="readiness-kicker">MATCH FORMAT · 本场规格</span>
            </div>
            <dl class="waiting-spec-list">
              <div class="waiting-spec-row">
                <dt>比赛阶段</dt>
                <dd>{{ view.meta.label }}</dd>
              </div>
              <div class="waiting-spec-row">
                <dt>胜负条件</dt>
                <dd>{{ view.seriesTarget }}</dd>
              </div>
              <div class="waiting-spec-row">
                <dt>上场模式</dt>
                <dd>{{ view.exhibition ? `${state.mode} 标准模式` : `常规 ${state.mode} · EX ${state.exA}/${state.exB}` }}</dd>
              </div>
              <div class="waiting-spec-row">
                <dt>先后手</dt>
                <dd :title="rollSummary">{{ rollSummary }}</dd>
              </div>
            </dl>
          </section>

          <section class="readiness-card" aria-label="双方到场与就绪状态">
            <div class="waiting-card-head">
              <span class="readiness-kicker">TEAM STATUS · 到场与就绪</span>
            </div>
            <div class="waiting-arrival-list">
              <div v-for="team in (['a', 'b'] as const)" :key="team" class="waiting-arrival-row" :data-team="team"
                :data-status="teamStatus(team)">
                <span class="waiting-arrival-team" :title="view.names[team]">{{ view.names[team] }}</span>
                <span class="waiting-arrival-roster">{{ view.hasRoster(team) ? `${view.fullRoster(team).length}人` : '待核对' }}</span>
                <strong class="waiting-arrival-state">{{ teamStatusLabel(team) }}</strong>
              </div>
            </div>
            <p class="readiness-copy">{{ view.readinessCopy }}</p>
          </section>
        </aside>

        <section class="team-roster" data-team-panel="b" :aria-label="`${view.names.b} 队伍完整名单`">
          <header class="roster-head">
            <div class="roster-team">
              <span class="roster-side-kicker">BLUE TEAM</span>
              <strong :title="view.names.b">{{ view.names.b }}</strong>
            </div>
            <div class="roster-head-meta">
              <span class="roster-count">{{ view.hasRoster('b') ? `${view.fullRoster('b').length} 名队员` : `名单待核对 · ${state.mode}` }}</span>
              <span class="roster-status-pill" :data-status="teamStatus('b')">{{ teamStatusLabel('b') }}</span>
            </div>
          </header>
          <div class="waiting-roster-grid" :data-density="rosterDensity(view.fullRoster('b').length)"
            :data-count="view.fullRoster('b').length" data-roster="b">
            <article v-for="player in view.fullRoster('b')" :key="player.id" class="waiting-player-card"
              :class="[view.arrived('b') ? 'is-arrived' : 'is-waiting', { 'is-placeholder': player.placeholder }]"
              data-team="b" :data-slot="player.slot" :data-player-id="player.id"
              :data-arrival-state="view.arrived('b') ? 'arrived' : 'waiting'"
              :aria-label="`${view.names.b}，${displayName(player)}，#${player.slot}，${teamStatusLabel('b')}`">
              <Transition name="player-swap" mode="out-in">
                <div class="waiting-player-identity" :key="`${player.osuId ?? 'anonymous'}:${displayName(player)}`">
                  <div class="player-card-bg" aria-hidden="true">
                    <span class="player-cover-fallback"></span>
                    <img v-if="player.osuId != null" class="player-cover" :src="`/api/players/${player.osuId}/cover`" alt=""
                      @error="hideBroken">
                  </div>
                  <div class="waiting-avatar-shell">
                    <span class="player-avatar player-avatar-fallback" aria-hidden="true">{{ initial(player) }}</span>
                    <img v-if="!player.placeholder" class="player-avatar" :src="avatarUrl(player)"
                      :alt="`${displayName(player)} 的 osu! 头像`" @error="hideBroken">
                  </div>
                  <div class="waiting-player-copy">
                    <div class="waiting-player-meta">
                      <span class="waiting-player-slot">#{{ String(player.slot).padStart(2, '0') }}</span>
                      <span v-if="player.osuId != null" class="waiting-player-uid">UID {{ player.osuId }}</span>
                      <span v-else-if="player.placeholder" class="waiting-player-uid is-muted">待录入</span>
                    </div>
                    <p class="waiting-player-name" :title="displayName(player)">{{ displayName(player) }}</p>
                  </div>
                </div>
              </Transition>
            </article>
          </div>
        </section>
      </div>
    </div>

    <footer class="scene-footer waiting-footer" aria-label="本场图池信息">
      <div class="waiting-pool-card" data-waiting-pool>
        <div class="waiting-pool-head">
          <div class="waiting-pool-title-group">
            <span class="waiting-pool-kicker">MAPPOOL OVERVIEW · 本场图池</span>
            <strong class="waiting-pool-name" :title="view.poolName">{{ view.poolName }}</strong>
          </div>
          <div class="waiting-pool-badges">
            <span class="waiting-pool-badge">{{ view.pool.length ? `共 ${view.pool.length} 张谱面` : '图池待载入' }}</span>
            <span class="waiting-pool-badge is-subtle">{{ view.exhibition ? view.seriesTarget : '每队 2 Ban · 决胜图 TB' }}</span>
          </div>
        </div>
        <div v-if="poolGroups.length" class="waiting-pool-mods" :style="{ '--pool-mod-count': poolGroups.length }">
          <div v-for="group in poolGroups" :key="group.mod" class="waiting-mod-group" :data-mod="group.mod"
            :style="modColorStyle(group.mod)">
            <div class="waiting-mod-top">
              <strong class="waiting-mod-tag">{{ group.mod }}</strong>
              <span class="waiting-mod-count"><b>{{ group.count }}</b><small>张</small></span>
            </div>
            <span class="waiting-mod-range" :title="group.labels.join(' · ')">{{ group.range }}</span>
          </div>
        </div>
        <div v-else class="waiting-pool-empty">
          <p>尚未载入本场图池 · 请在控制台选择直播任务、已发布图池或手动录入</p>
        </div>
      </div>
    </footer>
  </section>
</template>
