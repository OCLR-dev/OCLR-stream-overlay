# Simulator score contest — 2026-11-06

Playing growth no longer adds a fixed 7000 vs 6500 per tick. A bounded rate adjustment tracks the sum of two different pressure waves, giving repeated chases and lead reversals. Both cumulative totals always increase; an existing manually entered lead is caught through faster trailing-side scoring, never score subtraction. Missing totals stay missing. Rates use elapsed milliseconds, independent of tick frequency.

Only the simulated Playing/growing signal changes. Manual growth-off mode, silent mode, explicit Ranking totals, scripted result ownership, and server match automation are unchanged. No online writes or invented tournament data.

Validation:
- Score tests pass at 100/250/1000ms ticks: monotonic integer totals, at least two reversals in the eight-second demo, repeated reversals over a minute, bounded differential, and preserved average total growth.
- Existing initial 1234567:1100000 lead becomes contested within 20 seconds without lowering either total; missing-side tests pass.
- Main isolated score + WebSocket integration suite: 13 tests passed.
- Custom branch score suite: 2 tests passed; matching simulator score helper/server change applied.
- Current 3001/24051 simulator restarted with backed-up persistent match and room. Match ID, series, rounds, pool and room IPC state preserved. This is simulated tosu only, not Windows osu!tourney validation.
