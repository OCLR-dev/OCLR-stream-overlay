<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useCanvasFit } from '../useOverlay';
import { useShowcase, type WebsitePoolSelection } from '../showcase';
import ShowcaseWebsite from './ShowcaseWebsite.vue';
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
const poolList = ref<HTMLElement | null>(null);
const poolDraft = ref('');
const dirty = ref(false);
const poolFeedback = ref('');
const importingWebsite = ref(false);
const stageDraft = ref('');
const stageDirty = ref(false);
const stageFeedback = ref('');
let editRevision = 0;
let stageRevision = 0;
let pending: ReturnType<typeof setTimeout>;
let pendingStage: ReturnType<typeof setTimeout>;
watch(() => snapshot.value?.poolText, value => { if (!dirty.value && value !== undefined) poolDraft.value = value; }, { immediate: true });
watch(() => snapshot.value?.stageLabel, value => { if (!stageDirty.value && value !== undefined) stageDraft.value = value; }, { immediate: true });
const source = computed<MapInfoSource>(() => ({ shared: true, emptyTitle: '等待客户端谱面',
  currentMap: connection.value === 'synced' ? snapshot.value?.currentMap || null : null,
  metadataEnabled: !!snapshot.value?.matchedId && !snapshot.value?.websitePool,
  artworkUrl: connection.value === 'synced' ? snapshot.value?.websiteArtwork : undefined,
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
async function syncStage() {
  clearTimeout(pendingStage);
  if (!stageDirty.value) return;
  if (connection.value !== 'synced') { stageFeedback.value = '等待连接恢复后自动同步'; return; }
  if (busy.value) { pendingStage = setTimeout(() => { void syncStage(); }, 300); return; }
  const revision = stageRevision;
  const ok = await command('stage-label', { value: stageDraft.value });
  if (revision !== stageRevision) { pendingStage = setTimeout(() => { void syncStage(); }, 450); return; }
  if (ok) { stageDirty.value = false; stageDraft.value = snapshot.value?.stageLabel || ''; stageFeedback.value = 'Stage 已自动同步'; }
  else stageFeedback.value = 'Stage 未同步，请检查输入或连接';
}
function editStage() {
  stageRevision++; stageDirty.value = true; stageFeedback.value = '停止输入后自动同步'; error.value = '';
  clearTimeout(pendingStage);
  pendingStage = setTimeout(() => { void syncStage(); }, 450);
}
async function importWebsitePool(selection: WebsitePoolSelection) {
  if (dirty.value || importingWebsite.value) return false;
  importingWebsite.value = true;
  try {
    const ok = await command('import-website', { ...selection });
    if (ok) poolFeedback.value = '已更新 Showcase 图池';
    return ok;
  } finally { importingWebsite.value = false; }
}
async function copyLoadedPool() {
  const revision = ++editRevision;
  clearTimeout(pending);
  if (await command('use-loaded-pool', { loadedPoolToken: snapshot.value?.loadedPoolToken })) {
    if (revision !== editRevision) { void syncPool(); return; }
    dirty.value = false; poolDraft.value = snapshot.value?.poolText || ''; poolFeedback.value = '已复制到 Showcase 图池';
  }
}
watch([() => connection.value === 'synced' ? snapshot.value?.matchedId : null,
  () => snapshot.value?.pool.map(map => map.id).join(',')], async ([id]) => {
  if (clean || !id) return;
  await nextTick();
  const list = poolList.value;
  const item = list?.querySelector<HTMLElement>('li[aria-current="true"]');
  if (!list || !item) return;
  // Move only this scroll container; keep the page, input focus and caret still.
  const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - list.clientTop;
  const bottom = top + item.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 4);
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
});
watch(connection, value => {
  if (value !== 'synced') return;
  if (dirty.value) void syncPool();
  if (stageDirty.value) void syncStage();
});
onMounted(() => { document.title = 'OCLR · 图池 Showcase'; document.body.classList.add('is-showcase'); });
onUnmounted(() => { clearTimeout(pending); clearTimeout(pendingStage); document.body.classList.remove('is-showcase'); });
</script>

<template>
  <div class="showcase-app" :class="{ 'showcase-clean': clean }">
    <aside v-if="!clean" class="showcase-controls" aria-label="Showcase 操作">
      <header class="showcase-heading">
        <span>OCLR / SHOWCASE</span>
        <h1>图池演示</h1>
        <nav class="showcase-navigation" aria-label="Showcase 页面切换">
          <a href="/control">返回直播控制台</a>
          <a href="/showcase?clean=1" target="_blank" rel="noopener">打开播出画面 ↗</a>
        </nav>
      </header>
      <p v-if="error || snapshot?.error" class="showcase-error" role="alert">{{ error || snapshot?.error }}</p>
      <section class="showcase-obs-setup" aria-labelledby="showcase-obs-heading">
        <h2 id="showcase-obs-heading">OBS 场景</h2>
        <ShowcaseObsSetup />
      </section>
      <label class="showcase-stage-input">当前 Stage
        <input v-model="stageDraft" type="text" maxlength="80" :disabled="connection !== 'synced'" :aria-invalid="stageDirty && !!error" placeholder="例如：32强、半决赛、决赛" aria-describedby="showcase-stage-feedback" @input="editStage" @blur="syncStage">
        <span id="showcase-stage-feedback" class="showcase-help" role="status">{{ stageFeedback || '顶部居中显示，留空隐藏' }}</span>
      </label>
      <section class="showcase-pool-setup" aria-labelledby="showcase-pool-heading">
        <h2 id="showcase-pool-heading">演示图池</h2>
        <p class="showcase-help">先录入列表，再在 osu! 中播放 rep。切换谱面时会自动识别 Slot。</p>
        <ShowcaseWebsite :can-import="connection === 'synced' && !busy && !dirty" :import-pool="importWebsitePool" />
        <p v-if="snapshot?.websitePool" class="showcase-help">当前来源：{{ snapshot.websitePool.edition.toUpperCase() }} · {{ snapshot.websitePool.name }}</p>
        <button :disabled="busy || connection !== 'synced' || !snapshot?.loadedPoolCount" @click="copyLoadedPool">复制控制台已加载图池<template v-if="snapshot?.loadedPoolCount">（{{ snapshot.loadedPoolCount }} 张）</template></button>
        <label class="showcase-pool-input">每行「Slot 谱面ID或链接 标题（可选）」
          <textarea v-model="poolDraft" rows="7" spellcheck="false" :disabled="connection !== 'synced' || importingWebsite" placeholder="NM1 谱面ID
HD1 https://osu.ppy.sh/beatmaps/具体难度ID"
            aria-describedby="showcase-pool-feedback" :aria-invalid="dirty && !!error" @input="editPool" @blur="syncPool"></textarea>
        </label>
        <p id="showcase-pool-feedback" class="showcase-help" role="status">{{ busy && dirty ? '正在同步图池…' : error && dirty ? '列表未应用，请修改上方提示的行' : poolFeedback || (snapshot?.pool.length ? `已录入 ${snapshot.pool.length} 张谱面` : '列表自动同步，无需逐张切换 Slot') }}</p>
      </section>
      <ul v-if="snapshot?.pool.length" ref="poolList" class="showcase-maps" aria-label="演示图池与当前匹配">
        <li v-for="map in snapshot.pool" :key="map.id" :data-current="connection === 'synced' && snapshot.matchedId === map.id" :aria-current="connection === 'synced' && snapshot.matchedId === map.id ? 'true' : undefined" :title="`${map.label} · ${map.title} [${map.difficulty}]`">
          <b :style="modColorStyle(map.mod)">{{ map.label }}</b>
          <span><strong>{{ map.title || `谱面 #${map.beatmapId}` }}</strong><small>{{ map.difficulty || `#${map.beatmapId}` }}</small></span>
        </li>
      </ul>
      <p class="showcase-help">Showcase 浏览器源保持 1920×1080 铺满画布，位置 (0,0)、缩放 1。osu! 回放采集自行放在它上方，在中央约 800px 高的区域内保持原比例居中显示。使用 tosu 读取普通客户端的当前谱面。</p>
    </aside>
    <main class="canvas-stage" ref="stage" aria-label="Showcase 画面预览">
      <p v-if="!clean" class="showcase-preview-status showcase-status" :data-state="connection === 'synced' ? snapshot?.sourceStatus : 'connecting'" :title="playbackStatus" role="status">{{ playbackStatus }}</p>
      <div class="canvas-sizer" :style="{ width: `${1920 * scale}px`, height: `${1080 * scale}px` }">
        <div class="broadcast-canvas showcase-canvas" :style="{ transform: `scale(${scale})` }" aria-label="1920×1080 图池 Showcase 播出画布" data-showcase-canvas>
          <div class="showcase-stage-ambient" aria-hidden="true">
            <SpectrumGrid />
            <ShowcaseAmbient />
          </div>
          <div class="showcase-game victory-body" aria-hidden="true"></div>
          <header v-if="snapshot?.stageLabel" class="showcase-stage-title" data-showcase-stage :title="snapshot.stageLabel">
            <span>STAGE</span>
            <strong>{{ snapshot.stageLabel }}</strong>
          </header>
          <div class="showcase-replay-area" data-showcase-capture aria-label="中央回放可用区域 1600×800，位置 160,100；osu! 保持原比例居中"></div>
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
  return () => h(ObsSettings, { obs, showcaseOnly: true, embedded: true });
} });
</script>
