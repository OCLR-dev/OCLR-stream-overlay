<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

// Only text wider than its box becomes a seamless two-copy ticker; short text
// stays still. Keep GAP in sync with .scrolling-text-copy padding in
// broadcast.css, and use a slow speed so a long rule stays readable.
const GAP = 28;
const SPEED = 40;
const props = defineProps<{ text: string }>();
const root = ref<HTMLElement | null>(null);
const copy = ref<HTMLElement | null>(null);
const scrolling = ref(false);
const duration = ref(12);
let observer: ResizeObserver | undefined;
let frame = 0;
let disposed = false;

const measure = () => {
  const viewport = root.value;
  const sample = copy.value;
  if (!viewport || !sample) return;
  const paddingRight = parseFloat(getComputedStyle(sample).paddingRight) || 0;
  const textWidth = Math.max(0, sample.offsetWidth - paddingRight);
  const overflow = textWidth > viewport.clientWidth + 1;
  if (overflow !== scrolling.value) {
    scrolling.value = overflow;
    void nextTick(schedule);
    return;
  }
  if (overflow) duration.value = Math.max(6, (textWidth + GAP) / SPEED);
};

const schedule = () => {
  if (disposed) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(measure);
};

watch(() => props.text, () => {
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
});
</script>

<template>
  <span ref="root" class="scrolling-text" :class="{ 'is-scrolling': scrolling }" :style="{ '--scrolling-text-duration': `${duration}s` }">
    <span class="scrolling-text-track">
      <span ref="copy" class="scrolling-text-copy">{{ text }}</span>
      <span v-if="scrolling" class="scrolling-text-copy" aria-hidden="true">{{ text }}</span>
    </span>
  </span>
</template>
