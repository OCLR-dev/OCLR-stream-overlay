<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

// The name sits in a fixed 360px slot so it cannot reach the live room score.
// Short names stay still and keep their normal alignment; only names wider
// than the slot become a seamless two-copy ticker. Keep GAP in sync with the
// .team-name-copy padding in broadcast.css.
const GAP = 40;
const SPEED = 64;
const props = defineProps<{ name: string }>();
const root = ref<HTMLElement | null>(null);
const copy = ref<HTMLElement | null>(null);
const scrolling = ref(false);
const duration = ref(14);
let observer: ResizeObserver | undefined;
let frame = 0;
let disposed = false;

const measure = () => {
  const viewport = root.value;
  const text = copy.value;
  if (!viewport || !text) return;
  const paddingRight = parseFloat(getComputedStyle(text).paddingRight) || 0;
  const textWidth = Math.max(0, text.offsetWidth - paddingRight);
  const overflow = textWidth > viewport.clientWidth;
  if (overflow !== scrolling.value) {
    scrolling.value = overflow;
    void nextTick(schedule);
    return;
  }
  if (overflow) duration.value = Math.max(10, (textWidth + GAP) / SPEED);
};

const schedule = () => {
  if (disposed) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(measure);
};

watch(() => props.name, () => {
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
  <span ref="root" class="team-name" :class="{ 'is-scrolling': scrolling }" :style="`--team-name-duration: ${duration}s`">
    <span class="team-name-track">
      <span ref="copy" class="team-name-copy">{{ name }}</span>
      <span v-if="scrolling" class="team-name-copy" aria-hidden="true">{{ name }}</span>
    </span>
  </span>
</template>
