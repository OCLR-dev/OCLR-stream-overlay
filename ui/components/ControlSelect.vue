<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useAttrs, useSlots, watch, type VNode } from 'vue';

defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue?: string | number; value?: string | number; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string | number]; change: [value: string | number] }>();
const attrs = useAttrs();
const slots = useSlots();
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const label = ref('');
const open = ref(false);
const active = ref(0);
const position = ref<Record<string, string>>({});
const id = `control-select-${crypto.randomUUID()}`;
type Option = { value: string | number; label: string; disabled: boolean };
const nodeText = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  return node && typeof node === 'object' && 'children' in node ? nodeText((node as VNode).children) : '';
};
const options = computed(() => {
  const result: Option[] = [];
  const visit = (nodes: VNode[]) => {
    for (const node of nodes) {
      if (node.type === 'option') {
        const text = nodeText(node.children);
        result.push({ value: node.props?.value ?? text, label: text, disabled: node.props?.disabled !== undefined && node.props.disabled !== false });
      } else if (Array.isArray(node.children)) visit(node.children as VNode[]);
    }
  };
  visit(slots.default?.() || []);
  return result;
});
const selected = computed(() => props.modelValue !== undefined ? props.modelValue : props.value);
const selectedIndex = computed(() => options.value.findIndex(option => String(option.value) === String(selected.value)));
const selectedLabel = computed(() => options.value[selectedIndex.value]?.label || '请选择');
function place() {
  if (!trigger.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - 8;
  const above = rect.top - 8;
  const height = Math.min(320, Math.max(44, options.value.length * 44 + 8));
  const upwards = below < Math.min(height, 160) && above > below;
  const maxHeight = Math.min(height, Math.max(44, upwards ? above : below));
  const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16);
  position.value = { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`, width: `${width}px`,
    top: `${upwards ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4}px`, maxHeight: `${maxHeight}px` };
}
async function reveal() {
  if (props.disabled) return;
  active.value = Math.max(0, selectedIndex.value);
  place(); open.value = true;
  await nextTick();
  menu.value?.querySelector<HTMLElement>(`[data-option-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' });
}
function choose(index: number) {
  const option = options.value[index];
  if (!option || option.disabled) return;
  emit('update:modelValue', option.value); emit('change', option.value);
  open.value = false; trigger.value?.focus({ preventScroll: true });
}
function move(delta: number) {
  const count = options.value.length;
  for (let i = 1; i <= count; i++) {
    const index = (active.value + delta * i + count * 2) % count;
    if (!options.value[index]?.disabled) {
      active.value = index;
      void nextTick(() => menu.value?.querySelector<HTMLElement>(`[data-option-index="${index}"]`)?.scrollIntoView({ block: 'nearest' }));
      return;
    }
  }
}
function keydown(event: KeyboardEvent) {
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) event.preventDefault();
  if (event.key === 'Escape') { open.value = false; event.stopPropagation(); }
  else if (event.key === 'Tab') open.value = false;
  else if (event.key === 'Enter' || event.key === ' ') { if (open.value) choose(active.value); else void reveal(); }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!open.value) void reveal(); else move(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Home' || event.key === 'End') {
    if (!open.value) void reveal();
    active.value = event.key === 'Home' ? 0 : Math.max(0, options.value.length - 1);
  }
}
function outside(event: PointerEvent) {
  const target = event.target as Node;
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) open.value = false;
}
function scroll(event: Event) { if (open.value && !menu.value?.contains(event.target as Node)) place(); }
watch(() => props.disabled, disabled => { if (disabled) open.value = false; });
onMounted(() => {
  const parent = trigger.value?.closest('label');
  label.value = parent ? [...parent.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim() : '';
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('scroll', scroll, true);
  window.addEventListener('resize', place);
});
onUnmounted(() => {
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('scroll', scroll, true);
  window.removeEventListener('resize', place);
});
</script>

<template>
  <span class="control-select">
    <button ref="trigger" v-bind="attrs" type="button" role="combobox" class="control-select-trigger" :disabled="disabled"
      :aria-label="String(attrs['aria-label'] || label || selectedLabel)" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="id"
      :aria-activedescendant="open ? `${id}-${active}` : undefined" @click="open ? open = false : reveal()" @keydown="keydown">
      <span class="control-select-label">{{ selectedLabel }}</span><span class="control-select-arrow" aria-hidden="true"></span>
    </button>
    <Teleport to="body">
      <div v-if="open" :id="id" ref="menu" class="control-select-menu" role="listbox" :aria-label="String(attrs['aria-label'] || label || '可选项目')" :style="position">
        <button v-for="(option, index) in options" :id="`${id}-${index}`" :key="index" type="button" role="option" tabindex="-1" :data-option-index="index"
          :aria-selected="index === selectedIndex" :disabled="option.disabled" :class="{ 'is-active': index === active }"
          @pointermove="active = index" @mousedown.prevent @click="choose(index)"><span aria-hidden="true">{{ index === selectedIndex ? '✓' : '' }}</span>{{ option.label }}</button>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.control-select { display: block; min-width: 0; width: 100%; }
.control-select-trigger { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; text-align: left; }
.control-select-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.control-select-arrow { flex: 0 0 7px; width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-2px) rotate(45deg); }
.control-select-menu { position: fixed; z-index: 10000; overflow: auto; padding: 4px; border: 1px solid #b68afa; border-radius: 6px; background: #251739; color: #f3eeff; box-shadow: 0 8px 28px #09041199; font: 15px/1.5 var(--sans, system-ui); box-sizing: border-box; }
.control-select-menu button { display: flex; align-items: start; gap: 8px; width: 100%; min-height: 44px; padding: 9px 10px; border: 0; border-radius: 3px; text-align: left; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.control-select-menu button > span { width: 18px; flex: 0 0 18px; }
.control-select-menu button.is-active { background: #583480; }.control-select-menu button[aria-selected='true'] { font-weight: 650; }
.control-select-menu button:disabled { opacity: .45; cursor: default; }
</style>
