<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useCanvasFit } from '../useOverlay';
import { useShowcase, type WebsitePoolSelection } from '../showcase';
import { replayLabel, useShowcaseReplays } from '../showcaseReplays';
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
const { list, busy: replayBusy, online: replayOnline, error: replayError, replayCommand } = useShowcaseReplays(!clean);
const replays = computed(() => list.value?.poolToken === snapshot.value?.poolToken ? list.value : null);
const rows = computed(() => new Map(replays.value?.rows.map(row => [row.slotId, row])));
const replayCache = computed(() => replays.value?.cache);
const replayLocked = computed(() => !replays.value || !replayOnline.value || replayBusy.value || busy.value ||
  replays.value.status === 'refreshing' || ['loading', 'waiting', 'playing'].includes(replays.value.playback.phase));
const slotLabel = (id: string | null | undefined) => snapshot.value?.pool.find(slot => slot.id === id)?.label;
const replayStatus = computed(() => {
  const state = replays.value;
  if (!state) return '正在连接回放清单…';
  const { phase, slotId, message } = state.playback;
  const slot = slotLabel(slotId);
  if (phase === 'loading') return `${slot} · 正在准备回放文件…`;
  if (phase === 'waiting') return `${slot} · 等待 osu! 开始回放`;
  if (phase === 'playing') return `${slot} · 正在播放`;
  if (phase === 'failed') return `${slot} · ${message}`;
  if (!state.nextSlot && phase === 'completed') return '已到清单末尾。可重播本张或点选其他 Slot。';
  if (state.gate === 'off') return '请将 Showcase 切到 OBS 节目画面并启用自动过场。';
  if (state.gate === 'cover') return '等待 OBS 遮挡确认…';
  return state.nextSlot ? `下一张 ${slotLabel(state.nextSlot)} · 遮挡已确认` : '';
});
let autoRefreshed: string | undefined;
watch([replays, replayOnline, busy, replayBusy], ([state, online, poolBusy, listBusy]) => {
  if (clean || !state || !online || poolBusy || listBusy || state.status !== 'unread' || autoRefreshed === state.poolToken) return;
  autoRefreshed = state.poolToken;
  void replayCommand('refresh');
});
function playReplay(action: 'play' | 'repeat') {
  const state = replays.value;
  if (!state) return;
  const slotId = action === 'repeat' ? state.playback.slotId : state.nextSlot;
  if (slotId && !rows.value.get(slotId)?.selectedId) {
    const item = poolList.value?.querySelector<HTMLElement>(`[data-slot="${CSS.escape(slotId)}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }
  void replayCommand(action, { slotId, replayId: slotId ? rows.value.get(slotId)?.selectedId ?? null : null, generation: state.generation });
}
const dropSlot = ref<string | null>(null);
function dragReplay(event: DragEvent, slotId: string) {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = replayLocked.value ? 'none' : 'copy';
  if (!replayLocked.value) dropSlot.value = slotId;
}
function dropReplay(event: DragEvent, slotId: string) {
  dropSlot.value = null;
  if (!replayLocked.value) attachReplay(event.dataTransfer?.files, slotId);
}
function attachReplay(files: FileList | null | undefined, slotId: string) {
  if (files?.length !== 1) { replayError.value = '请为这个 Slot 选择一份 .osr 文件。'; return; }
  const file = files.item(0)!;
  if (!/\.osr$/i.test(file.name) || file.size > 8 * 1024 * 1024) {
    replayError.value = '请选择 .osr 文件，最大 8 MiB。';
    return;
  }
  void replayCommand('attach', { slotId }, file);
}
function inputReplay(event: Event, slotId: string) {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) attachReplay(input.files, slotId);
  input.value = '';
}
function chooseFile(event: MouseEvent) {
  ((event.currentTarget as HTMLButtonElement).nextElementSibling as HTMLInputElement)?.click();
}
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
const source = computed<MapInfoSource>(() => {
  const state = connection.value === 'synced' ? snapshot.value : null;
  const currentMap = state?.currentMap || null;
  const websiteArtwork = state?.websiteArtwork;
  return { shared: true, emptyTitle: '等待客户端谱面', currentMap,
    metadataEnabled: !!state?.matchedId && !state.websitePool,
    artworkUrl: websiteArtwork !== undefined && currentMap ? `/api/beatmaps/${currentMap.beatmapId}/local-background` : websiteArtwork,
    artworkFallbackUrl: websiteArtwork,
    parameterMode: 'tosu', mapParameters: state?.mapParameters || null };
});
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
          <a href="/control" data-desktop-page="control">返回直播控制台</a>
          <a href="/showcase?clean=1" data-desktop-link="showcase-output" target="_blank" rel="noopener">打开播出画面 ↗</a>
          <a href="/showcase?cover-demo=1" data-desktop-link="showcase-demo" target="_blank" rel="noopener">测试过场动画 ↗</a>
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
        <p class="showcase-help">导入或录入图池后，核对每个 Slot 的回放。缺件可以把 .osr 拖到对应行。</p>
        <template v-if="snapshot?.pool.length">
          <div class="showcase-replay-actions">
            <button class="showcase-play-next" :disabled="replayLocked || replays?.gate !== 'ready' || !replays?.nextSlot" @click="playReplay('play')">播放下一张</button>
            <button :disabled="replayLocked || replays?.gate !== 'ready' || !replays?.playback.slotId" @click="playReplay('repeat')">重播本张</button>
            <button v-if="snapshot.websitePool" :disabled="replayLocked || replays?.status === 'stale'" @click="replayCommand('refresh')">刷新回放</button>
            <button v-if="snapshot.websitePool" :disabled="replayLocked || replays?.status !== 'ready' || !replayCache || replayCache.running || replayCache.ready >= replayCache.total" @click="replayCommand('cache')">{{ replayCache?.running ? '正在缓存…' : '提前缓存回放' }}</button>
          </div>
          <p class="showcase-help" role="status">{{ replayStatus }}</p>
          <p v-if="replayCache?.total" class="showcase-help" role="status">
            网站回放已缓存 {{ replayCache.ready }}/{{ replayCache.total }}<template v-if="replayCache.failed"> · {{ replayCache.failed }} 份失败，可重试</template>
          </p>
          <p v-if="replays?.status === 'refreshing'" class="showcase-help" role="status">正在读取网站回放…</p>
          <p v-if="replayError || replays?.message" class="showcase-error" role="alert">{{ replayError || replays?.message }}</p>
          <ul ref="poolList" class="showcase-maps" aria-label="演示图池与回放">
            <li v-for="map in snapshot.pool" :key="map.id" :data-slot="map.id"
                :data-current="connection === 'synced' && snapshot.matchedId === map.id"
                :data-drop="dropSlot === map.id"
                :aria-current="connection === 'synced' && snapshot.matchedId === map.id ? 'true' : undefined"
                @dragover="dragReplay($event, map.id)" @dragleave="dropSlot = null" @drop.prevent="dropReplay($event, map.id)">
              <b :style="modColorStyle(map.mod)">{{ map.label }}</b>
              <span :title="`${map.title} [${map.difficulty}]`"><strong>{{ map.title || `谱面 #${map.beatmapId}` }}</strong><small>{{ map.difficulty || `#${map.beatmapId}` }}</small></span>
              <div class="showcase-replay-options">
                <select v-if="(rows.get(map.id)?.options.length || 0) > 1" :aria-label="`${map.label} 回放`" :disabled="replayLocked"
                        :value="rows.get(map.id)?.selectedId || ''"
                        @change="replayCommand('select', { slotId: map.id, replayId: ($event.target as HTMLSelectElement).value })">
                  <option disabled value="">选择回放</option>
                  <option v-for="replay in rows.get(map.id)?.options" :key="replay.id" :value="replay.id">{{ replayLabel(replay) }}</option>
                </select>
                <p v-else-if="rows.get(map.id)?.options[0]">{{ replayLabel(rows.get(map.id)!.options[0]!) }}</p>
                <p v-else class="showcase-help">{{ snapshot.websitePool && replays?.status !== 'ready' ? '网站回放未读取' : '尚未上传' }}</p>
                <div class="showcase-replay-row-actions">
                  <span v-if="snapshot.transition?.shown.includes(map.id)">已播</span>
                  <span v-if="rows.get(map.id)?.cached">已缓存</span>
                  <span v-else-if="rows.get(map.id)?.cacheError" :title="rows.get(map.id)?.cacheError">缓存失败</span>
                  <span v-if="replays?.nextSlot === map.id">下一张</span>
                  <button v-else-if="rows.get(map.id)?.selectedId" :disabled="replayLocked" :aria-label="`将 ${map.label} 设为下一张`" @click="replayCommand('next', { slotId: map.id })">设为下一张</button>
                  <button :disabled="replayLocked" :aria-label="`为 ${map.label} 选择本地回放`" @click="chooseFile">选文件</button>
                  <input type="file" accept=".osr" hidden @change="inputReplay($event, map.id)">
                </div>
              </div>
            </li>
          </ul>
        </template>
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
