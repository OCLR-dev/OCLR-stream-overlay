<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useCanvasFit } from '../useOverlay';
import { useShowcase } from '../showcase';
import { useObsControl } from '../obsControl';
import { modColorStyle } from '../modColors';
import type { MapInfoSource } from '../mapInfo';
import MapInfoCard from './MapInfoCard.vue';
import ChatBox from './ChatBox.vue';
import ObsSettings from './ObsSettings.vue';
import SpectrumGrid from './SpectrumGrid.vue';
import ShowcaseAmbient from './ShowcaseAmbient.vue';
import seasonLogo from '../assets/oclr-s11-logo-white.svg';
import '../showcase.css';

const clean = new URLSearchParams(location.search).get('clean') === '1';
const { snapshot, connection, busy, error, command } = useShowcase();
const { stage, scale } = useCanvasFit();
const poolDraft = ref('');
const dirty = ref(false);
const poolFeedback = ref('');
let editRevision = 0;
let pending: ReturnType<typeof setTimeout>;
watch(() => snapshot.value?.poolText, value => { if (!dirty.value && value !== undefined) poolDraft.value = value; }, { immediate: true });
const source = computed<MapInfoSource>(() => ({ shared: true, emptyTitle: '等待客户端谱面',
  currentMap: connection.value === 'synced' ? snapshot.value?.currentMap || null : null,
  metadataEnabled: !!snapshot.value?.matchedId,
  parameterMode: 'tosu', mapParameters: connection.value === 'synced' ? snapshot.value?.mapParameters || null : null }));
const playbackStatus = computed(() => {
  if (connection.value !== 'synced') return '正在连接本机 Showcase…';
  const s = snapshot.value;
  if (!s) return '等待客户端谱面';
  if (s.sourceStatus === 'matched') return `正在演示 ${s.currentMap?.label} · ${s.currentMap?.title || '曲名待补充'}`;
  return { unavailable: '等待 osu! 普通客户端数据', tourney: '当前数据来自赛事客户端，请让 tosu 读取普通客户端',
    'no-map': '客户端尚未提供有效谱面', 'no-pool': '已读取当前谱面，请录入图池以匹配 Slot',
    ambiguous: '当前谱面对应多个 Slot，请核对图池列表；播出 Slot 显示 —', unmatched: '当前谱面不在图池中，播出 Slot 显示 —' }[s.sourceStatus];
});
async function syncPool() {
  clearTimeout(pending);
  if (!dirty.value) return;
  if (connection.value !== 'synced') { poolFeedback.value = '等待连接恢复后自动同步'; return; }
  if (busy.value) { pending = setTimeout(() => { void syncPool(); }, 300); return; }
  const revision = editRevision;
  const ok = await command('pool-text', { text: poolDraft.value });
  if (revision !== editRevision) { pending = setTimeout(() => { void syncPool(); }, 450); return; }
  if (ok) { dirty.value = false; poolDraft.value = snapshot.value?.poolText || ''; poolFeedback.value = '图池已自动同步'; }
}
function editPool() {
  editRevision++; dirty.value = true; poolFeedback.value = '停止输入后自动同步'; error.value = '';
  clearTimeout(pending);
  pending = setTimeout(() => { void syncPool(); }, 450);
}
async function copyLoadedPool() {
  const revision = ++editRevision;
  clearTimeout(pending);
  if (await command('use-loaded-pool', { loadedPoolToken: snapshot.value?.loadedPoolToken })) {
    if (revision !== editRevision) { void syncPool(); return; }
    dirty.value = false; poolDraft.value = snapshot.value?.poolText || ''; poolFeedback.value = '已复制到 Showcase 图池';
  }
}
watch(connection, value => { if (value === 'synced' && dirty.value) void syncPool(); });
onMounted(() => { document.title = 'OCLR · 图池 Showcase'; document.body.classList.add('is-showcase'); });
onUnmounted(() => { clearTimeout(pending); document.body.classList.remove('is-showcase'); });
</script>

<template>
  <div class="showcase-app" :class="{ 'showcase-clean': clean }">
    <aside v-if="!clean" class="showcase-controls" aria-label="Showcase 操作">
      <header class="showcase-heading">
        <span>OCLR / SHOWCASE</span>
        <h1>图池演示</h1>
        <a href="/showcase?clean=1" target="_blank" rel="noopener">打开播出画面 ↗</a>
      </header>
      <p class="showcase-status" role="status">{{ playbackStatus }}</p>
      <p v-if="error || snapshot?.error" class="showcase-error" role="alert">{{ error || snapshot?.error }}</p>
      <section class="showcase-pool-setup" aria-labelledby="showcase-pool-heading">
        <h2 id="showcase-pool-heading">演示图池</h2>
        <p class="showcase-help">先录入列表，再在 osu! 中播放 rep。切换谱面时会自动识别 Slot。</p>
        <button :disabled="busy || connection !== 'synced' || !snapshot?.loadedPoolCount" @click="copyLoadedPool">复制控制台已加载图池<template v-if="snapshot?.loadedPoolCount">（{{ snapshot.loadedPoolCount }} 张）</template></button>
        <label class="showcase-pool-input">每行「Slot 谱面ID或链接 标题（可选）」
          <textarea v-model="poolDraft" rows="7" spellcheck="false" :disabled="connection !== 'synced'" placeholder="NM1 谱面ID
HD1 https://osu.ppy.sh/beatmaps/具体难度ID"
            aria-describedby="showcase-pool-feedback" :aria-invalid="!!error" @input="editPool" @blur="syncPool"></textarea>
        </label>
        <p id="showcase-pool-feedback" class="showcase-help" role="status">{{ busy ? '正在同步图池…' : error ? '列表未应用，请修改上方提示的行' : poolFeedback || (snapshot?.pool.length ? `已录入 ${snapshot.pool.length} 张谱面` : '列表自动同步，无需逐张切换 Slot') }}</p>
      </section>
      <ul v-if="snapshot?.pool.length" class="showcase-maps" aria-label="演示图池与当前匹配">
        <li v-for="map in snapshot.pool" :key="map.id" :data-current="connection === 'synced' && snapshot.matchedId === map.id" :aria-current="connection === 'synced' && snapshot.matchedId === map.id ? 'true' : undefined" :title="`${map.label} · ${map.title} [${map.difficulty}]`">
          <b :style="modColorStyle(map.mod)">{{ map.label }}</b>
          <span><strong>{{ map.title || `谱面 #${map.beatmapId}` }}</strong><small>{{ map.difficulty || `#${map.beatmapId}` }}</small></span>
        </li>
      </ul>
      <p class="showcase-help">使用 tosu 读取 osu! 普通客户端的当前谱面。在 OBS 自行添加回放采集源，放到 Showcase 浏览器源上方，并完整缩放到上半区；16:9 画面可使用 1600×900，位置 (160, 0)。</p>
      <ShowcaseObsSetup />
    </aside>
    <main class="canvas-stage" ref="stage" aria-label="Showcase 画面预览">
      <div class="canvas-sizer" :style="{ width: `${1920 * scale}px`, height: `${1080 * scale}px` }">
        <div class="broadcast-canvas showcase-canvas" :style="{ transform: `scale(${scale})` }" aria-label="1920×1080 图池 Showcase 播出画布" data-showcase-canvas>
          <div class="showcase-stage-ambient" aria-hidden="true">
            <SpectrumGrid />
            <ShowcaseAmbient />
          </div>
          <div class="showcase-game victory-body" data-showcase-capture aria-label="单客户端回放演示区域，游戏采集在 OBS 中叠放到本背景上方"></div>
          <footer class="showcase-footer">
            <div class="showcase-logo">
              <img :src="seasonLogo" width="690" height="240" alt="OCLR S11 比赛 Logo" decoding="async">
            </div>
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
