<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { formatCounterScore, parseCounterScore, ScoreCounter } from '../scoreCounter';
const props = defineProps<{ value: string; scope: string; enabled: boolean }>();
const text = ref(props.value);
const counter = new ScoreCounter();
let frame = 0;
let preference: MediaQueryList | undefined;
const render = () => { text.value = counter.value === null ? props.value : formatCounterScore(counter.value, props.value); };
const tick = (now: number) => {
  frame = 0;
  const active = counter.tick(now); render();
  if (active) frame = requestAnimationFrame(tick);
};
function sync(animate: boolean) {
  cancelAnimationFrame(frame); frame = 0;
  const allowed = animate && !preference?.matches && !document.hidden;
  counter.update(parseCounterScore(props.value), performance.now(), allowed);
  render();
  if (allowed) frame = requestAnimationFrame(tick);
}
watch(() => [props.value, props.scope, props.enabled] as const, (next, old) => {
  sync(!!old && next[2] && old[2] && next[1] === old[1]);
}, { immediate: true, flush: 'sync' });
const changedVisibility = () => sync(false);
const changedPreference = () => { if (preference?.matches) sync(false); };
onMounted(() => {
  preference = matchMedia('(prefers-reduced-motion: reduce)');
  preference.addEventListener('change', changedPreference);
  document.addEventListener('visibilitychange', changedVisibility);
  sync(false);
});
onBeforeUnmount(() => { cancelAnimationFrame(frame); preference?.removeEventListener('change', changedPreference); document.removeEventListener('visibilitychange', changedVisibility); });
</script>

<template><span class="score-counter" aria-hidden="true">{{ text }}</span></template>

<style scoped>
.score-counter { font-variant-numeric: tabular-nums; }
</style>
