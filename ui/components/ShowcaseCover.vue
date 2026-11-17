<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { PoolEntry } from '../session';
import { modColorStyle } from '../modColors';
import {
  COVER_BAND_COUNT, COVER_BAND_FIRST, COVER_BAND_PITCH, COVER_BAND_WIDTH, COVER_TIMING,
  coverEnterTotal, coverLeaveTotal, progressGroups, titleWeight, type CoverStage,
} from '../showcaseCover';
import seasonLogo from '../assets/oclr-s11-logo-white.svg';
import '../showcase-cover.css';

// Issue #57 preview: full-frame curtain for the Showcase transition scene.
// The holding stage is fully opaque; translucency only exists while the
// curtain moves. Stage title and season logo are anchored at the exact
// Showcase positions so the curtain sweeps under them without a seam.
const props = withDefaults(defineProps<{
  covered: boolean;
  // Hard cut: the next rep may already be on screen, so no entry animation.
  instant?: boolean;
  next: PoolEntry | null;
  artworkUrl?: string | null;
  pool: PoolEntry[];
  shown: readonly string[];
  stageLabel?: string;
  reduced?: boolean;
  slow?: number;
  // Review only: freeze one moving stage at a time offset.
  seek?: { stage: 'entering' | 'leaving'; ms: number } | null;
}>(), { instant: false, artworkUrl: null, stageLabel: '', reduced: false, slow: 1, seek: null });
const emit = defineEmits<{ stage: [stage: CoverStage] }>();

const mediaReduced = ref(false);
let media: MediaQueryList | undefined;
const onMedia = () => { mediaReduced.value = !!media?.matches; };
const reducedMotion = computed(() => props.reduced || mediaReduced.value);

// Mounting while already covered is a silent baseline: no entry animation.
const stage = ref<CoverStage>(props.covered ? 'holding' : 'hidden');
const instantNow = ref(props.covered);
let timer: ReturnType<typeof setTimeout> | undefined;
const scaled = (ms: number) => (reducedMotion.value ? COVER_TIMING.reduced : ms) * props.slow;

function setStage(value: CoverStage) {
  if (stage.value === value) return;
  stage.value = value;
  emit('stage', value);
}
function cut() {
  clearTimeout(timer);
  instantNow.value = true;
  setStage('holding');
}
watch(() => [props.covered, props.instant] as const, ([covered, instant]) => {
  if (covered) {
    // A cover request while leaving, or an urgent one while entering, must not
    // wait for motion: the next rep's results page may already be visible.
    if (instant || stage.value === 'leaving') { if (stage.value !== 'holding') cut(); return; }
    if (stage.value !== 'hidden') return;
    clearTimeout(timer);
    instantNow.value = false;
    setStage('entering');
    timer = setTimeout(() => setStage('holding'), scaled(coverEnterTotal));
  } else {
    if (stage.value === 'hidden' || stage.value === 'leaving') return;
    clearTimeout(timer);
    instantNow.value = false;
    setStage('leaving');
    timer = setTimeout(() => setStage('hidden'), scaled(coverLeaveTotal));
  }
});

const shownStage = computed<CoverStage>(() => props.seek?.stage ?? stage.value);
const bands = Array.from({ length: COVER_BAND_COUNT }, (_, index) => ({ index, left: COVER_BAND_FIRST + index * COVER_BAND_PITCH }));
const diamonds = Array.from({ length: 34 }, (_, index) => {
  const duration = 8 + index * 7 % 9;
  return { x: 3 + index * 37.7 % 94, y: 8 + index * 23.9 % 72, size: 6 + index * 5 % 6 * 2,
    duration, delay: -(index * 1.73 % duration), opacity: .22 + index % 5 * .06 };
});

const shownSet = computed(() => new Set(props.shown));
const groups = computed(() => progressGroups(props.pool, shownSet.value, props.next?.id ?? null));
const doneCount = computed(() => props.pool.filter(entry => shownSet.value.has(entry.id)).length);
// Footer track 1410px wide (x 480–1890): 8px between chips, 20px between groups.
const chipWidth = computed(() => {
  const count = props.pool.length;
  if (!count) return 0;
  const gaps = (count - 1) * 8 + (groups.value.length - 1) * 12;
  return Math.max(36, Math.min(96, Math.floor((1410 - gaps) / count)));
});
const pad = (value: number) => String(value).padStart(2, '0');

const artLoaded = ref(false);
const artFailed = ref(false);
watch(() => props.artworkUrl, () => { artLoaded.value = false; artFailed.value = false; });
const hasArt = computed(() => !!props.artworkUrl && !artFailed.value);

const rootStyle = computed(() => ({
  '--cover-slow': props.seek ? 1 : props.slow,
  '--cover-seek': `${props.seek?.ms ?? 0}ms`,
  '--chip-w': `${chipWidth.value}px`,
}));

onMounted(() => {
  media = matchMedia('(prefers-reduced-motion: reduce)');
  onMedia();
  media.addEventListener('change', onMedia);
});
onUnmounted(() => { clearTimeout(timer); media?.removeEventListener('change', onMedia); });
</script>

<template>
  <div class="showcase-cover" :data-stage="shownStage"
    :class="{ 'is-instant': instantNow && !seek, 'is-reduced': reducedMotion, 'is-seeking': !!seek, 'is-compact-chips': chipWidth < 60 }"
    :style="rootStyle" :aria-hidden="shownStage === 'hidden' ? 'true' : undefined" aria-label="换图过场">
    <div class="cover-base"></div>
    <div class="cover-bands">
      <i v-for="band in bands" :key="band.index" class="cover-band" :style="{ left: `${band.left}px`, width: `${COVER_BAND_WIDTH}px`, '--i': band.index }"></i>
    </div>
    <div class="cover-texture" aria-hidden="true">
      <i v-for="(diamond, index) in diamonds" :key="index" class="cover-diamond" :class="{ 'is-solid': index % 4 === 0, 'is-pale': index % 3 === 1 }"
        :style="{ left: `${diamond.x}%`, top: `${diamond.y}%`, width: `${diamond.size}px`, height: `${diamond.size}px`,
          '--duration': `${diamond.duration}s`, '--delay': `${diamond.delay}s`, '--opacity': diamond.opacity }"></i>
    </div>
    <div class="cover-content">
      <div class="cover-feature">
        <Transition name="cover-swap">
          <section v-if="next" :key="next.id" class="cover-next" :data-mod="next.mod" :style="modColorStyle(next.mod)">
            <div class="cover-art" :data-art="hasArt && artLoaded ? 'image' : 'slot'">
              <img v-if="hasArt" :src="artworkUrl!" alt="" decoding="async" @load="artLoaded = true" @error="artFailed = true">
              <b v-if="!hasArt || !artLoaded" class="cover-art-slot" aria-hidden="true">{{ next.label }}</b>
            </div>
            <div class="cover-meta">
              <span class="cover-kicker">NEXT MAP</span>
              <b class="cover-slot">{{ next.label }}</b>
              <h2 class="cover-title" :data-long="titleWeight(next.title) > 40 || undefined">{{ next.title || `谱面 #${next.beatmapId}` }}</h2>
              <p v-if="next.artist" class="cover-artist">{{ next.artist }}</p>
              <p v-if="next.difficulty" class="cover-difficulty">[{{ next.difficulty }}]</p>
            </div>
          </section>
          <section v-else key="brand" class="cover-brand">
            <strong>MAPPOOL</strong>
            <span class="cover-kicker cover-kicker--center">SHOWCASE</span>
          </section>
        </Transition>
      </div>
      <div v-if="pool.length" class="cover-progress" :aria-label="`图池演示进度 ${doneCount} / ${pool.length}`">
        <header>
          <span class="cover-kicker">PROGRESS</span>
          <b><em>{{ pad(doneCount) }}</em> / {{ pad(pool.length) }}</b>
        </header>
        <ol class="cover-progress-track">
          <li v-for="(group, groupIndex) in groups" :key="`${group.mod}-${groupIndex}`">
            <ol class="cover-progress-group">
              <li v-for="chip in group.chips" :key="chip.entry.id" class="cover-chip" :data-state="chip.state" :data-mod="chip.entry.mod"
                :style="modColorStyle(chip.entry.mod)" :title="chip.entry.label">{{ chip.entry.label }}</li>
            </ol>
          </li>
        </ol>
      </div>
    </div>
    <!-- Same classes and positions as the Showcase page: pixel-identical, so
         the curtain appears to pass underneath them. -->
    <div class="cover-anchors">
      <header v-if="stageLabel" class="showcase-stage-title" :title="stageLabel">
        <span>STAGE</span>
        <strong>{{ stageLabel }}</strong>
      </header>
      <div class="showcase-footer cover-anchor-footer">
        <div class="showcase-logo">
          <img :src="seasonLogo" width="690" height="240" alt="OCLR S11 比赛 Logo" decoding="async">
        </div>
      </div>
    </div>
  </div>
</template>
