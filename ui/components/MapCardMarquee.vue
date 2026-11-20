<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

// Text that fits stays still. Wider text becomes a seamless two-copy ticker;
// the pass ends exactly when the second copy reaches the left edge, so the 2s
// hold always shows the beginning again. The slot keeps the card's own markup
// (for example the artist / difficulty spans) in both copies.
// Keep GAP in sync with .map-card-marquee-copy padding in broadcast.css.
const GAP = 40;
const SPEED = 55;
const HOLD_SECONDS = 2;
const props = defineProps<{ text: string }>();
const root = ref<HTMLElement | null>(null);
const copy = ref<HTMLElement | null>(null);
const track = ref<HTMLElement | null>(null);
const scrolling = ref(false);
let animation: Animation | undefined;
let motionKey = '';
let observer: ResizeObserver | undefined;
let frame = 0;
let disposed = false;

const stop = () => {
  animation?.cancel();
  animation = undefined;
  motionKey = '';
};

const start = (distance: number) => {
  const strip = track.value;
  if (!strip || typeof strip.animate !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const travelSeconds = distance / SPEED;
  const holdRatio = HOLD_SECONDS / (HOLD_SECONDS + travelSeconds);
  animation = strip.animate([
    { transform: 'translateX(0)' },
    { transform: 'translateX(0)', offset: holdRatio },
    { transform: `translateX(-${distance}px)` }
  ], {
    duration: (HOLD_SECONDS + travelSeconds) * 1000,
    iterations: Infinity,
    easing: 'linear'
  });
};

const measure = () => {
  const viewport = root.value;
  const sample = copy.value;
  if (!viewport || !sample) return;
  const paddingRight = parseFloat(getComputedStyle(sample).paddingRight) || 0;
  const textWidth = Math.max(0, sample.offsetWidth - paddingRight);
  const overflow = textWidth > viewport.clientWidth + 1;
  if (overflow !== scrolling.value) {
    scrolling.value = overflow;
    stop();
    void nextTick(schedule);
    return;
  }
  if (!overflow) {
    stop();
    return;
  }
  // Re-measuring after the two-copy layout settles must not restart the hold.
  const key = String(textWidth);
  if (!animation || key !== motionKey) {
    stop();
    motionKey = key;
    start(textWidth + GAP);
  }
};

const schedule = () => {
  if (disposed) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(measure);
};

watch(() => props.text, () => {
  stop();
  scrolling.value = false;
  void nextTick(schedule);
});

onMounted(() => {
  observer = new ResizeObserver(schedule);
  if (root.value) observer.observe(root.value);
  if (copy.value) observer.observe(copy.value);
  void document.fonts.ready.then(schedule);
  schedule();
});

onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  cancelAnimationFrame(frame);
  stop();
});
</script>

<template>
  <span class="map-card-marquee" :title="text">
    <span ref="root" class="map-card-marquee-viewport" :class="{ 'is-scrolling': scrolling }">
      <span ref="track" class="map-card-marquee-track">
        <span ref="copy" class="map-card-marquee-copy"><slot>{{ text }}</slot></span>
        <span v-if="scrolling" class="map-card-marquee-copy" aria-hidden="true"><slot>{{ text }}</slot></span>
      </span>
    </span>
  </span>
</template>
