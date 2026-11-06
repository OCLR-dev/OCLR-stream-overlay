<script setup lang="ts">
import { reactive } from 'vue';
import { useOverlay } from '../useOverlay';
const { state } = useOverlay();
// Randomize once on mount and again at each ribbon's invisible loop boundary.
// Reactive match updates never regenerate this independent decorative state.
type BandName = 'field' | 'top' | 'bottom';
type Ribbon = { x: number; y: number; length: number; thickness: number; tone: string; alpha: number; duration: number; delay: number };
const between = (min: number, max: number) => min + Math.random() * (max - min);
function appearance(name: BandName, x = between(0, 100)) {
  return {
    x,
    y: name === 'field' ? between(220, 940) : name === 'top' ? between(145, 198) : between(36, 210),
    length: Math.round(120 + Math.random() ** 1.4 * 300),
    thickness: name === 'top' ? between(6, 12) : name === 'field' ? between(20, 56) : between(7, 52),
    tone: Math.random() < .45 ? 'violet' : x < 40 ? 'pink' : 'ice',
    alpha: name === 'top' ? between(.09, .12) : name === 'field' ? between(.10, .13) : between(.16, .24),
  };
}
const bands = reactive(([
  { name: 'field', count: 12 }, { name: 'top', count: 8 }, { name: 'bottom', count: 18 },
] as const).map(band => ({
  name: band.name,
  ribbons: Array.from({ length: band.count }, (_, index): Ribbon => {
    const duration = band.name === 'field' ? between(42, 54) : between(30, 54);
    return {
      ...appearance(band.name, (index + Math.random()) / band.count * 100),
      duration,
      delay: -Math.random() * duration,
    };
  }),
})));
function renew(event: AnimationEvent, name: BandName, ribbon: Ribbon) {
  if (event.animationName !== 'lazer-ribbon-drift') return;
  // Keep duration and delay stable: changing them would jump the animation
  // timeline. New geometry appears only after the next fade-in has started.
  Object.assign(ribbon, appearance(name));
}
</script>

<template>
  <div v-show="state.scene === 'playing' || state.scene === 'mappool'" class="lazer-ribbon-edge" aria-hidden="true">
    <div v-for="band in bands" :key="band.name" class="lazer-ribbon-band" :class="`lazer-ribbon-band--${band.name}`">
      <div v-if="band.name === 'bottom'" class="lazer-ribbon-foot"></div>
      <span v-for="(ribbon, index) in band.ribbons" :key="index" class="lazer-ribbon" :data-tone="ribbon.tone"
        @animationiteration.self="renew($event, band.name, ribbon)"
        :style="{ left: `${ribbon.x}%`, top: `${ribbon.y}px`, width: `${ribbon.length}px`, height: `${ribbon.thickness}px`,
          '--ribbon-alpha': ribbon.alpha, '--ribbon-duration': `${ribbon.duration}s`, '--ribbon-delay': `${ribbon.delay}s` }"></span>
    </div>
  </div>
</template>
