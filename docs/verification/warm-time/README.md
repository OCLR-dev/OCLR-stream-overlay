# Warm-up — 2026-11-06

A persistent on/off practice mode in the operator console. No timer, no dedicated scene and no scene transition on toggling. While active, source telemetry continues but the formal room observer is bypassed: no BP, preparation, start, Ranking processing, win awards, retractions or automatic scene following. Existing automation preferences are retained. The pending Pick scene timer is cancelled. Manual output scene selection remains available; formal BP/result controls are replaced with a practice score panel.

Broadcast: keep current live team totals and score difference. Hide all gilded series values, win pips and the victory scene's final series result; never use saved formal totals or Pick ownership as practice data. Closing the mode restores the preserved series display. Entering during an unfinished formal game is rejected. Exiting requires fresh Idle/Waiting telemetry, consuming that baseline so practice maps/Ranking are not replayed. A previously recorded current result is protected from practice scores, including late Ranking frames. Initialization clears the mode; restoring a session retains it.

Validation:
- Main full regression: 395 passed. Custom full regression: 389 passed. Fixed-port portable lifecycle excluded to retain the running 3001 service.
- Four new tests in each branch cover in/out-of-pool heat maps, restart, no formal progress or scene changes, guarded exit, normal BP after exit, prepared-round resumption, saved-score isolation and late Ranking protection.
- Both Vue type checks and production builds passed.
- Actual console toggle used; it did not change the current scene. Playing was explicitly chosen manually for visual verification.
- In the actual embedded preview, warmTime=true, series and pip DOM count=0, and two live team totals remained visible. Alpha capture centers remained clear.
- During a simulated Playing on a previously banned map: preserved official series 7:6, all 13 recorded winners/final scores, and Ban slots unchanged. Practice score growth stopped after verification. Warm-up remains enabled for the user to inspect.
- 3001 restarted with session/room backup before validation. No website writes or real osu!tourney/OBS testing.
