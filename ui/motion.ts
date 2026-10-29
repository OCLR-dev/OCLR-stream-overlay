import { onUnmounted, ref, watch, type Directive, type Ref } from 'vue';

interface Emphasis {
  value: unknown;
  scope: string;
  enabled?: boolean;
  kind?: 'panel' | 'winner';
}

// Presentation only: never queue animations or write back to match state.
const running = new Map<HTMLElement, Animation>();
let preference: MediaQueryList | undefined;
function reducedMotion() {
  if (!preference) {
    preference = matchMedia('(prefers-reduced-motion: reduce)');
    preference.addEventListener('change', event => {
      if (event.matches) for (const animation of running.values()) animation.cancel();
    });
  }
  return preference.matches;
}
export function shouldEmphasize(next: Emphasis, previous: Emphasis) {
  return next.enabled !== false && previous.enabled !== false && next.scope === previous.scope &&
    JSON.stringify(next.value) !== JSON.stringify(previous.value);
}

export const vEmphasize: Directive<HTMLElement, Emphasis> = {
  updated(element, { value, oldValue }) {
    if (!oldValue) return;
    if (value.scope !== oldValue.scope || value.enabled === false) running.get(element)?.cancel();
    if (!shouldEmphasize(value, oldValue) || reducedMotion()) return;
    running.get(element)?.cancel();
    const frames: Keyframe[] = value.kind === 'panel'
      ? [{ opacity: .72, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }]
      : value.kind === 'winner'
        ? [{ opacity: .55, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }]
        : [{ opacity: .45 }, { opacity: 1 }];
    const animation = element.animate(frames, { duration: value.kind === 'winner' ? 300 : value.kind === 'panel' ? 160 : 240, easing: 'cubic-bezier(.2,.7,.3,1)' });
    running.set(element, animation);
    animation.onfinish = () => { if (running.get(element) === animation) running.delete(element); };
    animation.oncancel = animation.onfinish;
  },
  beforeUnmount(element) { running.get(element)?.cancel(); running.delete(element); }
};

// Establish a silent baseline after load, reconnect or a new match. No appear animation.
export function useMotionReady(scope: Ref<string>) {
  const ready = ref(false);
  let frame = 0;
  watch(scope, () => {
    ready.value = false;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { ready.value = true; });
    });
  }, { immediate: true, flush: 'sync' });
  onUnmounted(() => cancelAnimationFrame(frame));
  return ready;
}
