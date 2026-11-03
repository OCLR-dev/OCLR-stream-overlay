<script setup lang="ts">
// Small diamonds drift toward the upper right inside the star and pool slots.
// Seeds are deterministic so every capture frame matches the previous one.
const props = withDefaults(defineProps<{ seed?: number }>(), { seed: 0 });
const particles = Array.from({ length: 16 }, (_, index) => {
  const spread = index + props.seed * 5;
  return {
    x: 4 + spread * 37 % 92,
    y: 6 + spread * 53 % 96,
    dx: 24 + spread * 13 % 52,
    dy: -(46 + spread * 17 % 64),
    size: 3 + spread % 4,
    opacity: .28 + spread % 4 * .1,
    duration: 9 + spread * 5 % 7,
    delay: -(spread * 7 % 17),
  };
});
</script>

<template>
  <div class="slot-particles" aria-hidden="true">
    <span v-for="(particle, index) in particles" :key="index" class="slot-particle"
      :style="{ left: `${particle.x}%`, top: `${particle.y}%`, '--dx': `${particle.dx}px`, '--dy': `${particle.dy}px`,
        '--size': `${particle.size}px`, '--opacity': particle.opacity, '--duration': `${particle.duration}s`,
        '--delay': `${particle.delay}s` }"></span>
  </div>
</template>
