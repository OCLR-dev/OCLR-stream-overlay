<script setup lang="ts">
// Staggered paths give a loose scatter without timers or match-state updates.
const particles = Array.from({ length: 16 }, (_, index) => ({
  x: 20 + index * 67 % 200,
  y: 18 + index * 41 % 112,
  dx: index * 43 % 108 - 54,
  dy: index * 29 % 72 - 36,
  size: 1.4 + index % 4 * .45,
  opacity: .28 + index % 3 * .1,
  duration: 11 + index * 7 % 10,
  delay: -(index * 13 % 23),
}));
</script>

<template>
  <div class="header-ambient" aria-hidden="true">
    <div v-for="team in ['a', 'b']" :key="team" class="header-ambient-wing" :data-team="team">
      <span v-for="(particle, index) in particles" :key="index" class="header-ambient-particle"
        :style="{ left: `${particle.x}px`, top: `${particle.y}px`, '--dx': `${particle.dx}px`, '--dy': `${particle.dy}px`,
          '--size': `${particle.size}px`, '--opacity': particle.opacity, '--duration': `${particle.duration}s`,
          '--delay': `${particle.delay - (team === 'b' ? 5 : 0)}s` }"></span>
    </div>
  </div>
</template>
