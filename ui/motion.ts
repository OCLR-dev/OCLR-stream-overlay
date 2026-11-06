import { onUnmounted, ref, watch, type Directive, type Ref } from 'vue';

interface Emphasis {
  value: unknown;
  scope: string;
  enabled?: boolean;
  visible?: boolean;
  kind?: 'panel' | 'winner' | 'confirm' | 'pip';
  when?: boolean;
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
  return next.when !== false && next.enabled !== false && previous.enabled !== false && next.visible !== false &&
    (previous.visible !== false || next.kind === 'confirm') && next.scope === previous.scope &&
    JSON.stringify(next.value) !== JSON.stringify(previous.value);
}

function cancelEmphasis(element: HTMLElement) {
  running.get(element)?.cancel();
  running.delete(element);
}

function emphasize(element: HTMLElement, kind?: Emphasis['kind']) {
  cancelEmphasis(element);
  // Both teams reveal Ban/Pick from left to right.
  const hidden = 'inset(0 100% 0 0)';
  const frames: Keyframe[] = kind === 'confirm'
    ? [{ opacity: 1, clipPath: hidden }, { opacity: 1, clipPath: 'inset(0 0% 0 0)', offset: .1375 }, { opacity: 1, clipPath: 'inset(0 0% 0 0)', offset: .78 }, { opacity: 0, clipPath: 'inset(0 0% 0 0)' }]
    : kind === 'pip'
      ? [{ opacity: .45, transform: 'rotate(45deg) scale(.8)' }, { opacity: 1, transform: 'rotate(45deg) scale(1)' }]
      : kind === 'winner'
        ? [{ opacity: .55, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }]
        : kind === 'panel'
          // A long decelerating translate spends its last third under one device
          // pixel. Pixel snapping turns that tail into a held edge plus a 1px
          // hop, which reads as a hitch right before the panel settles. Finish
          // the travel while it still moves about a pixel per frame, then hold.
          ? [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)', offset: .86 }, { opacity: 1, transform: 'translateY(0)' }]
          : [{ opacity: .45 }, { opacity: 1 }];
  const duration = kind === 'confirm' ? 1600 : kind === 'panel' ? 460 : kind === 'winner' ? 380 : kind === 'pip' ? 300 : 220;
  const animation = element.animate(frames, { duration, easing: kind === 'confirm' ? 'linear' : 'cubic-bezier(.2,.7,.3,1)' });
  running.set(element, animation);
  animation.onfinish = () => { if (running.get(element) === animation) running.delete(element); };
  animation.oncancel = animation.onfinish;
}

export const vEmphasize: Directive<HTMLElement, Emphasis> = {
  updated(element, { value, oldValue }) {
    if (!oldValue) return;
    if (value.scope !== oldValue.scope || value.enabled === false || value.visible === false || value.when === false) cancelEmphasis(element);
    if (!shouldEmphasize(value, oldValue) || reducedMotion()) return;
    emphasize(element, value.kind);
  },
  beforeUnmount: cancelEmphasis
};

// Scene roots and capture ancestors switch instantly. Only these explicitly
// selected information surfaces may enter; outgoing animations never queue.
const sceneSurfaces = ':scope > .scene-footer, :scope > .scene-body:not(.playing-body):not(.victory-body), .victory-mark, .victory-copy, .victory-result, .victory-body > .scene-head';
export const vSceneReveal: Directive<HTMLElement, Emphasis> = {
  updated(stack, { value, oldValue }) {
    if (!oldValue) return;
    const scene = stack.querySelector<HTMLElement>(':scope > .scene.is-active');
    if (value.scope !== oldValue.scope || value.enabled === false || value.value !== oldValue.value) {
      // Child directives update first. Preserve a fresh confirmation already
      // started in the incoming scene; cancel outgoing or obsolete-scope work.
      for (const element of running.keys()) if (stack.contains(element) &&
        (value.scope !== oldValue.scope || value.enabled === false || !scene?.contains(element))) cancelEmphasis(element);
    }
    if (!shouldEmphasize(value, oldValue) || reducedMotion()) return;
    scene?.querySelectorAll<HTMLElement>(sceneSurfaces).forEach(element => {
      // Guard future layout changes: a surface containing a capture is never animated.
      if (element.matches('[data-game-capture]') || element.querySelector('[data-game-capture]')) return;
      emphasize(element, element.classList.contains('victory-copy') ? 'winner' : 'panel');
    });
  },
  beforeUnmount(stack) {
    for (const element of running.keys()) if (stack.contains(element)) cancelEmphasis(element);
  }
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
