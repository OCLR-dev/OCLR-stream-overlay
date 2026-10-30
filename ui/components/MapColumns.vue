<script setup lang="ts">
import { computed } from 'vue';
import { vEmphasize } from '../motion';
import { useOverlay } from '../useOverlay';
import MapArtwork from './MapArtwork.vue';
const { view, state, motionScope } = useOverlay();
const maxColumns = 4;
const groups = computed(() => ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'].map(mod => ({
  mod, entries: view.value.pool.filter(entry => entry.mod === mod)
})).filter(group => group.entries.length).map(group => ({ ...group, rows: Math.ceil(group.entries.length / maxColumns) })));
const columns = computed(() => Math.min(maxColumns, Math.max(1, ...groups.value.map(group => group.entries.length))));
const rows = computed(() => Math.max(1, groups.value.reduce((sum, group) => sum + group.rows, 0)));
</script>

<template>
  <div class="mappool-columns" :class="{ 'mappool-columns--dense': columns === maxColumns, 'mappool-columns--stacked': rows > 6 }" data-mappool-columns :style="{ '--mappool-rows': rows, '--pool-columns': columns, '--map-thumbnail-width': rows > 6 ? '44px' : '78px' }">
    <p v-if="!groups.length" class="pool-empty">尚未加载本场图池 · 请在控制台设置</p>
    <article v-for="group in groups" :key="group.mod" class="mappool-column" :data-mod="group.mod" :aria-label="`${group.mod} 谱面列表`" :style="{ gridRow: `span ${group.rows}`, '--group-rows': group.rows }">
      <header class="map-group-head"><strong>{{ group.mod }}</strong></header>
      <ol class="map-list">
        <li v-for="entry in group.entries" :key="entry.id" class="map-entry"
          :class="{ 'is-banned': entry.status === 'banned', 'is-picked': entry.status === 'picked' || entry.status === 'used' }"
          :data-map-index="entry.id" :data-map-state="entry.status" :data-team="entry.actionTeam" :data-mod="group.mod">
          <MapArtwork :beatmap-id="entry.beatmapId" :live="view.mapParameters?.id === entry.beatmapId" />
          <span class="map-thumbnail"><span class="map-index" :title="entry.label">{{ entry.label }}</span></span>
          <span class="map-copy"><span class="map-title" :title="entry.title || '标题未知'">{{ entry.title || '标题未知' }}</span><span v-if="entry.artist || entry.difficulty" class="map-meta">{{ entry.artist || '—' }} / {{ entry.difficulty || '—' }}</span></span>
          <span v-show="entry.status !== 'open'" v-emphasize="{ value: [entry.status, entry.statusLabel], scope: motionScope, enabled: state.scene === 'mappool' }" class="map-status" :class="`state-${entry.status}`" :title="entry.statusLabel" :aria-label="entry.statusLabel">{{ entry.actionTeam === 'a' ? '红 ' : entry.actionTeam === 'b' ? '蓝 ' : '' }}{{ entry.status === 'banned' ? 'Ban' : entry.status === 'used' ? '已打' : 'Pick' }}</span>
        </li>
      </ol>
    </article>
  </div>
</template>
