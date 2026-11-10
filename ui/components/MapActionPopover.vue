<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ dismiss: [] }>();
const menu = ref<HTMLElement>();
const position = ref({ left: '0px', top: '0px' });
const observer = new ResizeObserver(place);

function place() {
  if (!menu.value) return;
  const card = props.anchor.getBoundingClientRect();
  const pool = props.anchor.parentElement!.getBoundingClientRect();
  if (card.bottom <= Math.max(pool.top, 0) || card.top >= Math.min(pool.bottom, innerHeight)) {
    emit('dismiss');
    return;
  }
  const gap = 6;
  const { width, height } = menu.value.getBoundingClientRect();
  const left = Math.max(gap, Math.min(card.left, pool.right - width, innerWidth - width - gap));
  const top = card.bottom + gap + height <= innerHeight ? card.bottom + gap : Math.max(gap, card.top - height - gap);
  position.value = { left: left + 'px', top: top + 'px' };
}
function outside(event: Event) {
  const node = event.target;
  if (node instanceof Node && !menu.value?.contains(node) && !props.anchor.contains(node)) emit('dismiss');
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  props.anchor.focus({ preventScroll: true });
  emit('dismiss');
}
function focusMenu() {
  place();
  menu.value?.focus({ preventScroll: true });
}
watch(() => props.anchor, focusMenu, { flush: 'post' });
onMounted(() => {
  focusMenu();
  observer.observe(menu.value!);
  window.addEventListener('resize', place);
  document.addEventListener('scroll', place, true);
  document.addEventListener('pointerdown', outside);
  document.addEventListener('focusin', outside);
  document.addEventListener('keydown', escape);
});
onUnmounted(() => {
  observer.disconnect();
  window.removeEventListener('resize', place);
  document.removeEventListener('scroll', place, true);
  document.removeEventListener('pointerdown', outside);
  document.removeEventListener('focusin', outside);
  document.removeEventListener('keydown', escape);
});
</script>
<template>
  <div id="map-actions" ref="menu" class="desk-map-menu" role="group" aria-labelledby="map-title" tabindex="-1" :style="position"><slot /></div>
</template>
