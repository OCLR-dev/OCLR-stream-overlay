<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useCanvasFit } from '../useOverlay';
import type { PoolEntry } from '../session';
import type { MapInfoSource } from '../mapInfo';
import { modColor } from '../modColors';
import { coverEnterTotal, coverLeaveTotal, COVER_TIMING, type CoverStage } from '../showcaseCover';
import MapInfoCard from './MapInfoCard.vue';
import ChatBox from './ChatBox.vue';
import SpectrumGrid from './SpectrumGrid.vue';
import ShowcaseAmbient from './ShowcaseAmbient.vue';
import ShowcaseCover from './ShowcaseCover.vue';
import seasonLogo from '../assets/oclr-s11-logo-white.svg';
import '../showcase.css';

// Issue #57 visual preview. Everything here is synthetic: pool titles are
// marked as previews, the capture is a drawn stand-in for osu!, and the
// scenario timers stand in for tosu/OBS. Nothing is read from or sent to
// the session, tosu or OBS.
const RESULTS_HOLD_MS = 3500;
const WATCHING_STABLE_MS = 300;
const ASSUMED_DETECT_MS = 250;
const TITLES: [string, string, string][] = [
  ['Preview Title', 'Preview Artist', 'Insane'],
  ['A Considerably Longer Preview Title Used To Check Two-Line Wrapping', 'Preview Artist feat. Another Preview Artist', 'Extra'],
  ['演示曲名（中文字形检查）', '演示艺术家', 'Expert'],
  ['プレビュー曲名（日本語字形チェック）', 'プレビュー・アーティスト', 'Collab Extra'],
  ['Short', 'Preview Artist', 'Hard'],
];
const POOL_SHAPES = {
  13: [['NM', 4], ['HD', 2], ['HR', 2], ['DT', 2], ['FM', 2], ['TB', 1]],
  18: [['NM', 5], ['HD', 3], ['HR', 3], ['DT', 3], ['FM', 3], ['TB', 1]],
  24: [['NM', 7], ['HD', 4], ['HR', 4], ['DT', 4], ['FM', 4], ['TB', 1]],
} as const;
type PoolSize = keyof typeof POOL_SHAPES;
function buildPool(size: PoolSize): PoolEntry[] {
  let index = 0;
  return POOL_SHAPES[size].flatMap(([mod, count]) => Array.from({ length: count }, (_, n) => {
    const [title, artist, difficulty] = TITLES[index % TITLES.length]!;
    index++;
    const label = mod === 'TB' ? 'TB' : `${mod}${n + 1}`;
    return { id: `preview-${label}`, beatmapId: index, mod, label, title, artist, difficulty };
  }));
}
// Abstract stand-in artwork, generated locally from the slot colour.
function demoArtwork(entry: PoolEntry) {
  const tone = modColor(entry.mod).bg;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tone}"/><stop offset="1" stop-color="#1b1035"/></linearGradient>
<radialGradient id="r" cx=".72" cy=".3" r=".6"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>
<rect width="1280" height="720" fill="url(#g)"/><rect width="1280" height="720" fill="url(#r)"/>
<g fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="3">${Array.from({ length: 9 }, (_, i) => `<circle cx="${180 + i * 120}" cy="${520 - (i * 47) % 260}" r="${40 + (i * 23) % 60}"/>`).join('')}</g>
<text x="40" y="690" fill="#ffffff" fill-opacity=".55" font-family="sans-serif" font-size="28">演示封面 · ${entry.label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const { stage, scale } = useCanvasFit();
const poolSize = ref<PoolSize>(18);
const pool = computed(() => buildPool(poolSize.value));
const withArtwork = ref(true);
const reduced = ref(false);
const slow = ref(1);
const showCapture = ref(true);
const shown = shallowRef<string[]>([]);
const clientIndex = ref(0);
type Screen = 'replay' | 'results' | 'select' | 'loading';
const capture = ref<{ screen: Screen; index: number; leak: boolean }>({ screen: 'replay', index: 0, leak: false });
const covered = ref(false);
const instant = ref(false);
const coverStartId = ref<string | null>(null);
const coverStage = ref<CoverStage>('hidden');
const seekStage = ref<'off' | 'entering' | 'leaving'>('off');
const seekMs = ref(0);
const log = ref<{ at: number; text: string; tone?: 'leak' | 'ok' }[]>([]);
const startedAt = ref(performance.now());
const leaks = ref(0);

const at = (index: number) => pool.value[Math.min(index, pool.value.length - 1)]!;
const clientMap = computed(() => at(clientIndex.value));
const captureMap = computed(() => at(capture.value.index));
// State B only once the client has moved off the map that was on screen when
// the cover started; a same-map replay keeps the brand idle state.
const next = computed(() => (seekStage.value !== 'off' || coverStage.value !== 'hidden') && clientMap.value.id !== coverStartId.value ? clientMap.value : null);
const artworkFor = (entry: PoolEntry | null) => (entry && withArtwork.value ? demoArtwork(entry) : null);
const source = computed<MapInfoSource>(() => ({ shared: true, emptyTitle: '等待客户端谱面', currentMap: clientMap.value,
  metadataEnabled: false, artworkUrl: artworkFor(clientMap.value), parameterMode: 'tosu', mapParameters: null }));
const seek = computed(() => seekStage.value === 'off' ? null : { stage: seekStage.value, ms: seekMs.value });
const seekMax = computed(() => seekStage.value === 'leaving'
  ? (reduced.value ? COVER_TIMING.reduced : coverLeaveTotal) : (reduced.value ? COVER_TIMING.reduced : coverEnterTotal));
const exposed = computed(() => showCapture.value && capture.value.leak && coverStage.value !== 'holding');

function note(text: string, tone?: 'leak' | 'ok') {
  log.value = [...log.value.slice(-11), { at: (performance.now() - startedAt.value) / 1000, text, tone }];
}
function onStage(value: CoverStage) {
  coverStage.value = value;
  if (value === 'holding') note('已完全遮挡', 'ok');
  if (value === 'hidden') note('过场结束，可切回 Showcase 场景');
}
watch(exposed, value => { if (value && seekStage.value === 'off') { leaks.value++; note('⚠ 不应播出的成绩页露出', 'leak'); } });
function setCapture(screen: Screen, index: number, leak = false) {
  capture.value = { screen, index, leak };
  if (screen === 'results' && !leak) markShown(index);
}
function markShown(index: number) {
  const id = at(index).id;
  if (!shown.value.includes(id)) shown.value = [...shown.value, id];
}
function cover(hard = false) {
  if (covered.value && !hard) return;
  if (!covered.value) coverStartId.value = clientMap.value.id;
  instant.value = hard;
  covered.value = true;
}
function reveal() { covered.value = false; instant.value = false; }

let runId = 0;
const running = ref('');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms * slow.value));
async function run(name: string, steps: (alive: () => boolean) => Promise<void>) {
  const id = ++runId;
  running.value = name;
  seekStage.value = 'off';
  try { await steps(() => id === runId); } finally { if (id === runId) running.value = ''; }
}
function stop() { runId++; running.value = ''; }
function baseline(index: number) {
  startedAt.value = performance.now();
  log.value = [];
  leaks.value = 0;
  reveal();
  clientIndex.value = index;
  setCapture('replay', index);
}
const nextIndex = () => (clientIndex.value + 1) % pool.value.length;

const normal = () => run('正常换图', async alive => {
  const from = clientIndex.value;
  const to = nextIndex();
  baseline(from);
  note(`回放播放中 · ${at(from).label}`);
  await sleep(1600); if (!alive()) return;
  setCapture('results', from); note('进入本图成绩页，开始 3.5 秒展示');
  await sleep(RESULTS_HOLD_MS); if (!alive()) return;
  cover(); note('3.5 秒到：切到过场场景，斜幕进入');
  await sleep(coverEnterTotal + 500); if (!alive()) return;
  clientIndex.value = to; setCapture('select', to); note(`直播员在选歌界面选中 ${at(to).label} → 过场显示下一张`);
  await sleep(2000); if (!alive()) return;
  setCapture('results', to, true); note('打开 rep：下一份成绩页（应被遮住）');
  await sleep(1600); if (!alive()) return;
  setCapture('loading', to); note('加载回放');
  await sleep(900); if (!alive()) return;
  setCapture('replay', to); note('tosu 报告回放播放，等待稳定 300ms');
  await sleep(WATCHING_STABLE_MS); if (!alive()) return;
  reveal(); note('确认回放已开始：斜幕揭开');
});
const sameMap = () => run('同图重播', async alive => {
  const index = clientIndex.value;
  baseline(index);
  note(`回放播放中 · ${at(index).label}`);
  await sleep(1600); if (!alive()) return;
  setCapture('results', index); note('进入本图成绩页，开始 3.5 秒展示');
  await sleep(RESULTS_HOLD_MS); if (!alive()) return;
  cover(); note('3.5 秒到：切到过场场景（谱面未变，显示品牌待机）');
  await sleep(coverEnterTotal + 900); if (!alive()) return;
  setCapture('results', index, true); note('重新打开同图 rep：成绩页（应被遮住）');
  await sleep(1800); if (!alive()) return;
  setCapture('loading', index); note('加载回放');
  await sleep(900); if (!alive()) return;
  setCapture('replay', index); note('tosu 报告回放播放，等待稳定 300ms');
  await sleep(WATCHING_STABLE_MS); if (!alive()) return;
  reveal(); note('确认回放已开始：斜幕揭开');
});
const early = () => run('提前打开', async alive => {
  const from = clientIndex.value;
  const to = nextIndex();
  baseline(from);
  note(`回放播放中 · ${at(from).label}`);
  await sleep(1600); if (!alive()) return;
  setCapture('results', from); note('进入本图成绩页，开始 3.5 秒展示');
  await sleep(1400); if (!alive()) return;
  clientIndex.value = to; setCapture('select', to); note(`3.5 秒未到，直播员已回选歌选中 ${at(to).label}`);
  await sleep(ASSUMED_DETECT_MS); if (!alive()) return;
  cover(true); note(`检测到离开成绩页（假设延迟 ${ASSUMED_DETECT_MS}ms，待实测）：硬切遮挡`);
  await sleep(1500); if (!alive()) return;
  setCapture('results', to, true); note('打开 rep：下一份成绩页（应被遮住）');
  await sleep(1600); if (!alive()) return;
  setCapture('loading', to); note('加载回放');
  await sleep(900); if (!alive()) return;
  setCapture('replay', to); note('tosu 报告回放播放，等待稳定 300ms');
  await sleep(WATCHING_STABLE_MS); if (!alive()) return;
  reveal(); note('确认回放已开始：斜幕揭开');
});

function step(action: 'replay' | 'results' | 'leak' | 'cover' | 'cut' | 'reveal' | 'next' | 'prev' | 'reset') {
  stop();
  seekStage.value = 'off';
  if (action === 'replay') setCapture('replay', clientIndex.value);
  if (action === 'results') setCapture('results', clientIndex.value);
  if (action === 'leak') setCapture('results', clientIndex.value, true);
  if (action === 'cover') cover();
  if (action === 'cut') cover(true);
  if (action === 'reveal') reveal();
  if (action === 'next' || action === 'prev') {
    clientIndex.value = (clientIndex.value + (action === 'next' ? 1 : pool.value.length - 1)) % pool.value.length;
    setCapture('select', clientIndex.value);
  }
  if (action === 'reset') { shown.value = []; baseline(0); }
}
function changePool(event: Event) {
  poolSize.value = Number((event.target as HTMLSelectElement).value) as PoolSize;
  shown.value = shown.value.filter(id => pool.value.some(entry => entry.id === id));
  clientIndex.value = Math.min(clientIndex.value, pool.value.length - 1);
}
function freeze(value: 'off' | 'entering' | 'leaving') {
  stop();
  seekStage.value = value;
  seekMs.value = Math.min(seekMs.value, seekMax.value);
}
const screenText: Record<Screen, string> = { replay: '模拟回放画面', results: '模拟成绩页', select: '模拟选歌界面', loading: '模拟加载回放' };
onUnmounted(stop);
</script>

<template>
  <div class="showcase-app cover-demo">
    <aside class="showcase-controls" aria-label="过场预览评审控件">
      <header class="showcase-heading">
        <span>ISSUE #57 · 本地预览</span>
        <h1>Showcase 换图过场</h1>
        <p class="showcase-help">只用于评审美术与时序，不是直播员操作。所有谱面、封面、osu! 画面和 tosu／OBS 信号均为本页模拟。</p>
      </header>
      <section class="cover-demo-group" aria-labelledby="cover-demo-flows">
        <h2 id="cover-demo-flows">完整流程</h2>
        <div class="cover-demo-buttons">
          <button :aria-pressed="running === '正常换图'" @click="normal">正常换图</button>
          <button :aria-pressed="running === '同图重播'" @click="sameMap">同图重播</button>
          <button :aria-pressed="running === '提前打开'" @click="early">提前打开 rep</button>
          <button :disabled="!running" @click="stop">停止</button>
        </div>
        <p class="cover-demo-state" :data-tone="exposed ? 'leak' : coverStage === 'holding' ? 'ok' : undefined" role="status">
          遮挡：{{ { hidden: '未遮挡', entering: '斜幕进入中', holding: '已完全遮挡', leaving: '揭开中' }[coverStage] }}
          · 采集：{{ screenText[capture.screen] }} {{ captureMap.label }}<template v-if="capture.leak">（不应播出）</template>
          <template v-if="leaks"> · 露出 {{ leaks }} 次</template>
        </p>
        <ol class="cover-demo-log" aria-label="时间线">
          <li v-for="(entry, index) in log" :key="index" :data-tone="entry.tone"><time>{{ entry.at.toFixed(2) }}s</time>{{ entry.text }}</li>
        </ol>
      </section>
      <section class="cover-demo-group" aria-labelledby="cover-demo-steps">
        <h2 id="cover-demo-steps">单步</h2>
        <div class="cover-demo-buttons">
          <button @click="step('replay')">回放中</button>
          <button @click="step('results')">成绩页</button>
          <button @click="step('leak')">下一份成绩页</button>
          <button @click="step('prev')">上一张</button>
          <button @click="step('next')">下一张</button>
          <button @click="step('cover')">斜幕遮挡</button>
          <button @click="step('cut')">硬切遮挡</button>
          <button @click="step('reveal')">揭开</button>
          <button @click="step('reset')">重置进度</button>
        </div>
      </section>
      <section class="cover-demo-group" aria-labelledby="cover-demo-view">
        <h2 id="cover-demo-view">查看</h2>
        <label class="cover-demo-field">图池张数
          <select :value="poolSize" @change="changePool"><option :value="13">13 张</option><option :value="18">18 张</option><option :value="24">24 张</option></select>
        </label>
        <label class="cover-demo-field">播放速度
          <select v-model.number="slow"><option :value="1">正常</option><option :value="3">慢放 ×3</option><option :value="8">慢放 ×8</option></select>
        </label>
        <label class="cover-demo-check"><input v-model="withArtwork" type="checkbox"> 有封面（关闭时用 Slot 色块）</label>
        <label class="cover-demo-check"><input v-model="reduced" type="checkbox"> 减少动态效果</label>
        <label class="cover-demo-check"><input v-model="showCapture" type="checkbox"> 显示模拟 osu! 采集</label>
        <label class="cover-demo-field">定格检查
          <select :value="seekStage" @change="freeze(($event.target as HTMLSelectElement).value as 'off' | 'entering' | 'leaving')">
            <option value="off">关闭</option><option value="entering">进入</option><option value="leaving">揭开</option>
          </select>
        </label>
        <label v-if="seekStage !== 'off'" class="cover-demo-field">{{ seekMs }} / {{ seekMax }} ms
          <input v-model.number="seekMs" type="range" min="0" :max="seekMax" step="10">
        </label>
      </section>
    </aside>
    <main ref="stage" class="canvas-stage" aria-label="Showcase 过场预览">
      <div class="canvas-sizer" :style="{ width: `${1920 * scale}px`, height: `${1080 * scale}px` }">
        <div class="broadcast-canvas showcase-canvas" :style="{ transform: `scale(${scale})` }" data-showcase-canvas>
          <div class="showcase-stage-ambient" aria-hidden="true">
            <SpectrumGrid />
            <ShowcaseAmbient />
          </div>
          <div class="showcase-game victory-body" aria-hidden="true"></div>
          <header class="showcase-stage-title" data-showcase-stage>
            <span>STAGE</span>
            <strong>过场预览</strong>
          </header>
          <div class="showcase-replay-area cover-demo-replay" data-showcase-capture>
            <div v-if="showCapture" class="cover-demo-capture" :data-screen="capture.screen" :data-leak="capture.leak || undefined">
              <template v-if="capture.screen === 'replay'">
                <i v-for="n in 5" :key="n" class="cover-demo-circle" :style="{ left: `${14 + n * 15}%`, top: `${30 + (n * 37) % 40}%`, '--n': n }"></i>
                <span class="cover-demo-progress"></span>
              </template>
              <div class="cover-demo-label">
                <strong>{{ screenText[capture.screen] }}</strong>
                <span>{{ captureMap.label }} · {{ captureMap.title }}</span>
                <em v-if="capture.leak">下一份 rep 的成绩 · 不应播出</em>
                <em v-else-if="capture.screen === 'results'">本图成绩 · 允许展示 3.5 秒</em>
              </div>
            </div>
          </div>
          <ShowcaseCover :covered="covered" :instant="instant" :next="next" :artwork-url="artworkFor(next)" :pool="pool" :shown="shown"
            stage-label="过场预览" :reduced="reduced" :slow="slow" :seek="seek" @stage="onStage" />
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

<style>
.cover-demo .showcase-controls { flex-basis: 380px; }
.cover-demo-group { display: grid; gap: 10px; }
.cover-demo-group h2 { margin: 0; font-size: 16px; }
.cover-demo-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.cover-demo .showcase-controls .cover-demo-buttons button { min-height: 40px; padding: 6px 10px; }
.cover-demo .showcase-controls button[aria-pressed='true'] { border-color: var(--purple-light); background: #422363; }
.cover-demo-state { margin: 0; padding: 8px 10px; border: 1px solid var(--review-line); border-radius: 4px; color: var(--muted); }
.cover-demo-state[data-tone='ok'] { border-color: #4ade80; color: var(--ink); }
.cover-demo-state[data-tone='leak'] { border-color: #ff6b6b; color: #ffd0d0; background: #3a0d18; }
.cover-demo-log { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; color: var(--muted); font-size: 12px; }
.cover-demo-log time { display: inline-block; min-width: 54px; color: #8f7fb0; font-family: var(--mono); }
.cover-demo-log [data-tone='ok'] { color: #a7f3c0; }
.cover-demo-log [data-tone='leak'] { color: #ffabc1; }
.cover-demo-field { display: grid; gap: 6px; }
.cover-demo-check { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.cover-demo-check input { min-height: 0; width: 18px; height: 18px; }
.cover-demo .canvas-stage { align-items: center; }
.cover-demo-replay { z-index: 1; }
/* Synthetic stand-in for an osu! window: 16:9, centred in the 1600×800 area. */
.cover-demo-capture { position: absolute; top: 0; left: 89px; width: 1422px; height: 800px; overflow: hidden; background: radial-gradient(800px 500px at 60% 40%, #24425e, #0b1420); color: #eef6ff; }
.cover-demo-capture[data-screen='results'] { background: linear-gradient(160deg, #3b3f4a, #15171c); }
.cover-demo-capture[data-screen='select'] { background: linear-gradient(90deg, #1d2b3a, #0f1720 60%, #2a3646); }
.cover-demo-capture[data-screen='loading'] { background: #05070a; }
.cover-demo-capture[data-leak] { background: repeating-linear-gradient(135deg, #f5c400 0 60px, #1b1b1b 60px 120px); }
.cover-demo-label { position: absolute; left: 48px; bottom: 44px; display: grid; gap: 8px; padding: 18px 24px; background: #000000b3; border-radius: 6px; }
.cover-demo-label strong { font-size: 40px; }
.cover-demo-label span { font-size: 22px; opacity: .8; }
.cover-demo-label em { color: #ffd166; font-size: 24px; font-style: normal; font-weight: 700; }
.cover-demo-capture[data-leak] .cover-demo-label em { color: #ff5c5c; }
.cover-demo-circle { position: absolute; width: 120px; height: 120px; border: 8px solid #ffffffd9; border-radius: 50%; box-shadow: 0 0 0 4px #ff6fae66; animation: cover-demo-pulse 1.2s ease-in-out calc(var(--n) * -.24s) infinite; }
.cover-demo-progress { position: absolute; left: 0; top: 0; height: 6px; width: 100%; background: #ffffffcc; transform-origin: left; animation: cover-demo-progress 20s linear infinite; }
@keyframes cover-demo-pulse { 0%, 100% { opacity: .35; transform: scale(.92); } 50% { opacity: 1; transform: scale(1); } }
@keyframes cover-demo-progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }
</style>
