import { computed, inject, nextTick, onMounted, onUnmounted, reactive, ref, watch, type InjectionKey } from 'vue';
import { changeBan, changeField, derive, mapLabels, parseLocation, scenes, serializeState, urlKeys, type Field, type Team } from './model';

export function createOverlay() {
  const state = reactive(parseLocation(location.search, location.hash));
  const view = computed(() => derive(state));
  const feedback = ref('Ban 槽默认未确认。');
  const update = (field: Field, value: string) => Object.assign(state, changeField(state, field, value));
  const select = (field: Field, event: Event) => update(field, (event.target as HTMLSelectElement).value);
  const ban = (team: Team, index: 0 | 1, event: Event) => {
    const select = event.target as HTMLSelectElement;
    const result = changeBan(state, team, index, select.value);
    Object.assign(state, result.state);
    select.value = state.banSlots[team][index];
    feedback.value = result.feedback;
  };
  const cycleMap = () => {
    const order = ['banned', 'picked', 'open'] as const;
    update('map', order[(order.indexOf(state.map) + 1) % order.length]!);
  };
  const toggleClean = () => {
    update('clean', state.clean ? '0' : '1');
    if (state.clean && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return;
    if (/^[1-6]$/.test(event.key)) {
      event.preventDefault(); update('scene', scenes[Number(event.key) - 1]!);
    } else if (event.key.toLowerCase() === 'c' || (event.key === 'Escape' && state.clean)) {
      event.preventDefault(); toggleClean();
    }
  };
  const onLocation = () => Object.assign(state, parseLocation(location.search, location.hash));
  const stopWatch = watch(state, () => {
    const url = new URL(location.href);
    for (const key of [...Object.values(urlKeys), 'banA1', 'banA2', 'banB1', 'banB2']) url.searchParams.delete(key);
    url.hash = serializeState(state);
    try { history.replaceState(null, '', url); } catch { /* OBS can restrict history; rendering still works. */ }
    document.body.classList.toggle('is-clean', state.clean);
    Object.assign(document.body.dataset, {
      scene: state.scene, clean: String(state.clean), mode: state.mode,
      activeMode: `${view.value.count}v${view.value.count}`, lead: state.lead
    });
    document.title = state.clean ? '干净输出 · Esc 退出 · OCLR S11 Violet Orbit · Light' : 'OCLR S11 直播 UI · Vue 浅紫视觉评审';
  }, { immediate: true, flush: 'sync' });
  onMounted(() => {
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('hashchange', onLocation);
    window.addEventListener('popstate', onLocation);
  });
  onUnmounted(() => {
    stopWatch();
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('hashchange', onLocation);
    window.removeEventListener('popstate', onLocation);
    document.body.classList.remove('is-clean');
    for (const key of ['scene', 'clean', 'mode', 'activeMode', 'lead']) delete document.body.dataset[key];
  });
  return { state, view, feedback, update, select, ban, toggleClean, cycleMap, mapLabels };
}
export type OverlayController = ReturnType<typeof createOverlay>;
export const overlayKey: InjectionKey<OverlayController> = Symbol('overlay');
export function useOverlay() {
  const controller = inject(overlayKey);
  if (!controller) throw new Error('OVERLAY_PROVIDER_REQUIRED');
  return controller;
}

export function useCanvasFit() {
  const stage = ref<HTMLElement | null>(null);
  const scale = ref(1);
  let frame = 0;
  let observer: ResizeObserver | undefined;
  let disposed = false;
  const fit = () => {
    const element = stage.value;
    if (!element) return;
    const style = getComputedStyle(element);
    const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    scale.value = Math.max(0.001, Math.min(width / 1920, height / 1080));
  };
  const schedule = () => {
    if (disposed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };
  onMounted(async () => {
    await nextTick();
    if (disposed) return;
    fit();
    observer = new ResizeObserver(schedule);
    if (stage.value) observer.observe(stage.value);
    window.addEventListener('resize', schedule);
    void document.fonts.ready.then(schedule);
  });
  onUnmounted(() => { disposed = true; observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); });
  return { stage, scale };
}
