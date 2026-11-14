<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useCanvasFit } from '../useOverlay';
import { useShowcase } from '../showcase';
import { useObsControl } from '../obsControl';
import { modColorStyle } from '../modColors';
import type { MapInfoSource } from '../mapInfo';
import MapInfoCard from './MapInfoCard.vue';
import ChatBox from './ChatBox.vue';
import ObsSettings from './ObsSettings.vue';
import '../showcase.css';

const clean = new URLSearchParams(location.search).get('clean') === '1';
const { snapshot, connection, busy, error, select } = useShowcase();
const { stage, scale } = useCanvasFit();
const query = ref('');
const maps = computed(() => (snapshot.value?.pool || []).filter(map => `${map.label} ${map.title} ${map.difficulty}`.toLowerCase().includes(query.value.trim().toLowerCase())));
const selectedIndex = computed(() => snapshot.value?.pool.findIndex(map => map.id === snapshot.value?.selectedId) ?? -1);
const source = computed<MapInfoSource>(() => ({ shared: true, emptyTitle: '尚未选择谱面', currentMap: snapshot.value?.currentMap || null,
  parameterMode: 'tosu', mapParameters: connection.value === 'synced' ? snapshot.value?.mapParameters || null : null }));
const tosuStatus = computed(() => ({ off: '', unavailable: '等待普通客户端数据', tourney: '当前连接为赛事客户端',
  'different-map': '等待普通客户端播放所选谱面', matched: '已补充所选谱面的普通客户端参数' }[snapshot.value?.sourceStatus || 'off']));
function next(direction: number) {
  const pool = snapshot.value?.pool || [];
  const map = pool[selectedIndex.value + direction];
  if (map) void select(map.id);
}
onMounted(() => { document.title = 'OCLR · 图池 Showcase'; document.body.classList.add('is-showcase'); });
onUnmounted(() => { document.body.classList.remove('is-showcase'); });
</script>

<template>
  <div class="showcase-app" :class="{ 'showcase-clean': clean }">
    <aside v-if="!clean" class="showcase-controls" aria-label="Showcase 操作">
      <header class="showcase-heading">
        <span>OCLR / SHOWCASE</span>
        <h1>图池演示</h1>
        <a href="/showcase?clean=1" target="_blank" rel="noopener">打开播出画面 ↗</a>
      </header>
      <p class="showcase-status" role="status">{{ connection !== 'synced' ? '正在连接本机 Showcase…' : busy ? '正在切换展示谱面…' : snapshot?.currentMap ? `正在展示 ${snapshot.currentMap.label} · ${snapshot.currentMap.title || '曲名待补充'}` : '选择一张谱面开始展示' }}</p>
      <p v-if="error || snapshot?.error" class="showcase-error" role="alert">{{ error || snapshot?.error }}</p>
      <template v-if="snapshot?.pool.length">
        <div class="showcase-navigation">
          <button :disabled="busy || connection !== 'synced' || selectedIndex <= 0" @click="next(-1)">上一张</button>
          <span>{{ selectedIndex < 0 ? '—' : selectedIndex + 1 }} / {{ snapshot.pool.length }}</span>
          <button :disabled="busy || connection !== 'synced' || selectedIndex >= snapshot.pool.length - 1" @click="next(1)">下一张</button>
        </div>
        <label class="showcase-search">查找谱面<input v-model="query" type="search" placeholder="槽位、曲名或难度"></label>
        <div class="showcase-maps" aria-label="已加载图池">
          <button v-for="map in maps" :key="map.id" :aria-pressed="snapshot.selectedId === map.id" :disabled="busy || connection !== 'synced'" @click="select(map.id)" :title="`${map.label} · ${map.title} [${map.difficulty}]`">
            <b :style="modColorStyle(map.mod)">{{ map.label }}</b>
            <span><strong>{{ map.title || '曲名待补充' }}</strong><small>{{ map.difficulty || '难度名待补充' }}</small></span>
          </button>
          <p v-if="!maps.length">没有匹配的谱面</p>
        </div>
        <button :disabled="busy || connection !== 'synced' || !snapshot.selectedId" @click="select(null)">清除展示谱面</button>
        <label class="showcase-check"><input type="checkbox" :checked="snapshot.useTosu" :disabled="busy || connection !== 'synced'" @change="select(snapshot?.selectedId || null, ($event.target as HTMLInputElement).checked)">补充普通客户端的 tosu 谱面参数</label>
        <p v-if="snapshot.useTosu" class="showcase-help" role="status">{{ connection === 'synced' ? tosuStatus : '游戏数据暂不可用' }}</p>
      </template>
      <p v-else class="showcase-help">尚未加载图池。先在 <a href="/control" target="_blank" rel="noopener">控制台</a>加载本场图池，再回到这里选图。</p>
      <p class="showcase-help">在 osu! 普通客户端运行这张谱面的 rep；游戏画面在 OBS 中自行添加，放在 Showcase 浏览器源下方。</p>
      <ShowcaseObsSetup />
    </aside>
    <main class="canvas-stage" ref="stage" aria-label="Showcase 画面预览">
      <div class="canvas-sizer" :style="{ width: `${1920 * scale}px`, height: `${1080 * scale}px` }">
        <div class="broadcast-canvas showcase-canvas" :style="{ transform: `scale(${scale})` }" aria-label="1920×1080 图池 Showcase 播出画布" data-showcase-canvas>
          <div class="showcase-game" data-showcase-capture aria-label="单客户端回放演示区域"></div>
          <footer class="showcase-footer">
            <MapInfoCard :source="source" />
            <ChatBox source="stream" compact />
          </footer>
        </div>
      </div>
    </main>
  </div>
</template>

<script lang="ts">
import { defineComponent, h } from 'vue';
// The clean OBS output never opens an OBS management connection.
const ShowcaseObsSetup = defineComponent({ setup() {
  const obs = useObsControl();
  return () => h(ObsSettings, { obs, showcaseOnly: true });
} });
</script>
