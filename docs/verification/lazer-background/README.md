# Lazer background integration — 2026-11-06

Final user-approved preview: 28° upward diagonal rounded ribbons, about 20% faster than the first preview. Six sparse ribbons blend into the middle of the existing static grid, with stronger top/bottom accents. Playing remains quieter than Mappool. Old grid-pulse/diamond motion is hidden only in these two scenes; other scenes retain their decoration. Reduced-motion renders a static composition.

Only the component, its CSS, App mount and main stylesheet import were transferred. No preview toolbar, historical pool fixture, sample score, metadata override, Vite configuration or session changes are included. Both branches use identical component/CSS bytes; custom match functionality is retained.

## Validation

- Both branches: Vue type check, Vite build, and diff whitespace checks passed.
- Approved preview: eight mode/aspect/EX combinations retain capture dimensions and alpha cutouts. Interior hit tests find the page behind every cutout. No new transforms, opacity or filters on capture ancestors. These checks do not measure screenshot alpha pixels.
- Main production output on 3001: Mappool loads 22 ribbons, pace .83, hides old diamond/grid motion, and has no preview controls. Existing session was not changed for validation.
- main full regression: 389/390 passed. The portable lifecycle test needs exclusive fixed port 3001; the existing simulator owns this port, so its readiness check timed out. The running service was left intact.
- test/custom-match full regression: 382/384 passed initially. Same fixed-port failure; timing recorder also missed an initial frame during concurrent suites. Isolated timing-recorder rerun passed (1/1), leaving only the fixed-port portable check unverified in this environment.
- Real Windows osu!tourney/tosu/OBS CEF transparency and performance were not tested.
