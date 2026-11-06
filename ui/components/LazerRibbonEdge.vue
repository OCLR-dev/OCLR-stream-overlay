<script setup lang="ts">
import { useOverlay } from '../useOverlay';
const { state } = useOverlay();
// Fixed seeds: no timers, randomness, score coupling or scene remounts.
const ribbonSeeds = [
  // A sparse shared field blends the edge motif into the existing purple grid.
  // Production canvas clipping removes this layer from every capture hole.
  { name: 'field', ribbons: [
    { x: 0, y: 330, length: 330, thickness: 26, tone: 'pink', alpha: .10, duration: 54, delay: -24 },
    { x: 24, y: 510, length: 420, thickness: 42, tone: 'violet', alpha: .11, duration: 54, delay: -38 },
    { x: 65, y: 410, length: 240, thickness: 20, tone: 'ice', alpha: .12, duration: 42, delay: -16 },
    { x: 6, y: 800, length: 260, thickness: 36, tone: 'violet', alpha: .12, duration: 54, delay: -31 },
    { x: 42, y: 790, length: 420, thickness: 56, tone: 'ice', alpha: .11, duration: 54, delay: -22 },
    { x: 82, y: 870, length: 180, thickness: 28, tone: 'ice', alpha: .13, duration: 42, delay: -29 },
  ] },
  { name: 'top', ribbons: [
    { x: 6, y: 164, length: 220, thickness: 7, tone: 'pink', alpha: .09, duration: 54, delay: -19 },
    { x: 25, y: 174, length: 330, thickness: 10, tone: 'violet', alpha: .11, duration: 42, delay: -31 },
    { x: 56, y: 154, length: 190, thickness: 6, tone: 'ice', alpha: .10, duration: 54, delay: -12 },
    { x: 81, y: 168, length: 270, thickness: 8, tone: 'ice', alpha: .12, duration: 42, delay: -23 },
    { x: 40, y: 178, length: 130, thickness: 12, tone: 'pink', alpha: .10, duration: 30, delay: -9 },
  ] },
  { name: 'bottom', ribbons: [
    { x: 2, y: 130, length: 190, thickness: 32, tone: 'pink', alpha: .22, duration: 42, delay: -13 },
    { x: 17, y: 78, length: 300, thickness: 18, tone: 'violet', alpha: .18, duration: 54, delay: -38 },
    { x: 30, y: 156, length: 150, thickness: 10, tone: 'violet', alpha: .16, duration: 30, delay: -17 },
    { x: 44, y: 102, length: 420, thickness: 36, tone: 'ice', alpha: .20, duration: 54, delay: -22 },
    { x: 61, y: 164, length: 180, thickness: 14, tone: 'ice', alpha: .22, duration: 42, delay: -33 },
    { x: 76, y: 58, length: 280, thickness: 24, tone: 'ice', alpha: .24, duration: 30, delay: -8 },
    { x: 92, y: 148, length: 130, thickness: 7, tone: 'violet', alpha: .20, duration: 54, delay: -41 },
    { x: 49, y: 182, length: 420, thickness: 28, tone: 'violet', alpha: .16, duration: 42, delay: -27 },
    { x: 9, y: 170, length: 240, thickness: 52, tone: 'pink', alpha: .21, duration: 54, delay: -36 },
    { x: 28, y: 118, length: 130, thickness: 20, tone: 'pink', alpha: .24, duration: 30, delay: -21 },
    { x: 67, y: 144, length: 210, thickness: 48, tone: 'violet', alpha: .18, duration: 42, delay: -16 },
  ] },
];
// More short capsules expose rounded ends throughout the field. Extra paths
// are deterministic and share the existing drift cadence, without timers.
const bands = ribbonSeeds.map(band => ({
  ...band,
  ribbons: [
    ...band.ribbons,
    ...band.ribbons.slice(0, band.name === 'field' ? 6 : band.name === 'top' ? 3 : 7).map((ribbon, index) => ({
      ...ribbon,
      x: (ribbon.x + 29 + index * 7) % 100,
      y: band.name === 'field' ? 220 + (ribbon.y + 180) % 650 : 28 + (ribbon.y + 55) % 145,
      delay: ribbon.delay - ribbon.duration * .37,
    })),
  ],
}));
</script>

<template>
  <div v-show="state.scene === 'playing' || state.scene === 'mappool'" class="lazer-ribbon-edge" aria-hidden="true">
    <div v-for="band in bands" :key="band.name" class="lazer-ribbon-band" :class="`lazer-ribbon-band--${band.name}`">
      <div v-if="band.name === 'bottom'" class="lazer-ribbon-foot"></div>
      <span v-for="(ribbon, index) in band.ribbons" :key="index" class="lazer-ribbon" :data-tone="ribbon.tone"
        :style="{ left: `${ribbon.x}%`, top: `${ribbon.y}px`, width: `${ribbon.length}px`, height: `${ribbon.thickness}px`,
          '--ribbon-alpha': ribbon.alpha, '--ribbon-duration': `${ribbon.duration}s`, '--ribbon-delay': `${ribbon.delay}s` }"></span>
    </div>
  </div>
</template>
