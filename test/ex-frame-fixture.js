import { normalizeTosuV2 } from '../src/tosu.js';
import { initialRoom, makeV2Frame } from '../tools/tosu-simulator/frames.js';

export function exFrame(mapId, ipcState, teams) {
  const ranking = ipcState === 4;
  return normalizeTosuV2(makeV2Frame({ ...initialRoom(), mapId, ipcState,
    leftName: teams.left, rightName: teams.right, left: ranking ? 900 : 0, right: ranking ? 800 : 0 }));
}
