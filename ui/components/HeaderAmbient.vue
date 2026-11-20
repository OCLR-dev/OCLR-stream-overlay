<script setup lang="ts">
// Horizontal luminous drift in the y=130-180 sub-banner band flanking the score stage.
const particles = Array.from({ length: 22 }, (_, index) => ({
  x: 18 + (index * 97) % 560,
  y: 8 + (index * 19) % 34,
  dx: 48 + (index * 23) % 76,
  dy: (index % 5 - 2) * 3,
  size: 2.2 + (index % 3) * 0.85,
  opacity: 0.34 + (index % 3) * 0.14,
  duration: 9 + (index * 5) % 8,
  delay: -(index * 11 % 19),
}));
</script>

<template>
  <div class="header-ambient" aria-hidden="true">
    <div v-for="team in ['a', 'b']" :key="team" class="header-ambient-wing" :data-team="team">
      <span v-for="(particle, index) in particles" :key="index" class="header-ambient-particle"
        :style="{ left: `${particle.x}px`, top: `${particle.y}px`, '--dx': `${team === 'b' ? -particle.dx : particle.dx}px`, '--dy': `${particle.dy}px`,
          '--size': `${particle.size}px`, '--opacity': particle.opacity, '--duration': `${particle.duration}s`,
          '--delay': `${particle.delay - (team === 'b' ? 4 : 0)}s` }"></span>
    </div>
  </div>
</template>
