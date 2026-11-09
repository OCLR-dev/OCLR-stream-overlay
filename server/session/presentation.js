// Broadcast projection owns scene following. Competition transitions and
// identity checks complete before these requests are considered.
export function followScene(state, scene) {
  if (!state.auto.scenes || state.warmup) return;
  state.scene = scene;
  state.sceneOverride = null;
}

export function afterCommit(application, before, next, allowPickScene) {
  application.pickScene.update(before, next, allowPickScene);
  application.scheduleResume();
  application.scheduleWinnerConfirm();
}
