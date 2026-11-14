import { ObsError } from './socket.js';

export const showcaseScene = 'OCLR · Showcase';
export const showcaseBrowser = 'OCLR · Showcase 画面';

// Separate from the regular/EX preset: no captures, audio or follow target.
export async function buildShowcase(call, previous, url, save) {
  const { baseWidth, baseHeight } = await call('GetVideoSettings');
  if (baseWidth !== 1920 || baseHeight !== 1080) throw new ObsError('请先将 OBS 基础画布设为 1920×1080，再创建 Showcase 场景。');
  const { inputKinds } = await call('GetInputKindList');
  if (!inputKinds.includes('browser_source')) throw new ObsError('OBS 缺少浏览器源，请核对 OBS 安装。');
  const { scenes } = await call('GetSceneList');
  const { inputs } = await call('GetInputList');
  const { groups } = await call('GetGroupList');
  let state = { ...previous };
  let scene = scenes.find(s => s.sceneName === showcaseScene);
  let input = inputs.find(i => i.inputName === showcaseBrowser);
  if ((scene && (!previous || (state.sceneUuid && state.sceneUuid !== scene.sceneUuid))) ||
      (!scene && state.sceneUuid && scenes.some(s => s.sceneUuid === state.sceneUuid))) {
    throw new ObsError('Showcase 场景同名或已改名，请在 OBS 核对场景后重试。');
  }
  if (groups.includes(showcaseScene) || groups.includes(showcaseBrowser) || inputs.some(i => i.inputName === showcaseScene) || scenes.some(s => s.sceneName === showcaseBrowser)) {
    throw new ObsError('Showcase 名称已被占用，请在 OBS 给同名项目改名后重试。');
  }
  if (!input && state.inputUuid && inputs.some(i => i.inputUuid === state.inputUuid)) throw new ObsError('Showcase 浏览器源已改名，请在 OBS 恢复原名后重试。');
  if (input) {
    if (!previous || input.inputKind !== 'browser_source' || (state.inputUuid && input.inputUuid !== state.inputUuid)) throw new ObsError('Showcase 浏览器源同名或已被替换，请在 OBS 核对来源后重试。');
    if (!state.inputUuid) {
      const { inputSettings } = await call('GetInputSettings', { inputName: showcaseBrowser });
      if (inputSettings.url !== url || inputSettings.width !== 1920 || inputSettings.height !== 1080) throw new ObsError('Showcase 浏览器源与原设置不符，请在 OBS 核对后重试。');
    }
  }
  const checkpoint = async change => { state = { ...state, ...change }; await save(state); };
  if (scene?.sceneUuid && !state.sceneUuid) await checkpoint({ sceneUuid: scene.sceneUuid });
  if (input?.inputUuid && !state.inputUuid) await checkpoint({ inputUuid: input.inputUuid });
  if (!previous) await checkpoint({ ready: false });
  if (!scene) {
    await checkpoint({ ready: false, itemId: null, pendingPlacement: true });
    scene = await call('CreateScene', { sceneName: showcaseScene });
    await checkpoint({ sceneUuid: scene.sceneUuid || null });
  }
  const target = state.sceneUuid ? { sceneUuid: state.sceneUuid } : { sceneName: showcaseScene };
  let { sceneItems } = await call('GetSceneItemList', target);
  let items = sceneItems.filter(item => item.sourceName === showcaseBrowser);
  if (items.length > 1) throw new ObsError('Showcase 场景里有多个浏览器源场景项，请在 OBS 保留一项后重试。');
  let itemId = items[0]?.sceneItemId;
  if (!input || !items.length) {
    await checkpoint({ ready: false, pendingPlacement: true });
    const added = input
      ? await call('CreateSceneItem', { ...target, ...(input.inputUuid ? { sourceUuid: input.inputUuid } : { sourceName: showcaseBrowser }), sceneItemEnabled: false })
      : await call('CreateInput', { ...target, inputName: showcaseBrowser, inputKind: 'browser_source',
        inputSettings: { url, width: 1920, height: 1080, shutdown: false, restart_when_active: false }, sceneItemEnabled: false });
    itemId = added.sceneItemId;
    await checkpoint({ inputUuid: input?.inputUuid || added.inputUuid || null });
  }
  if (state.pendingPlacement || !state.ready || state.itemId !== itemId) {
    const item = { ...target, sceneItemId: itemId };
    await call('SetSceneItemTransform', { ...item, sceneItemTransform: { alignment: 5, positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, boundsType: 'OBS_BOUNDS_NONE' } });
    ({ sceneItems } = await call('GetSceneItemList', target));
    await call('SetSceneItemIndex', { ...item, sceneItemIndex: sceneItems.length - 1 });
    await call('SetSceneItemLocked', { ...item, sceneItemLocked: true });
    await call('SetSceneItemEnabled', { ...item, sceneItemEnabled: true });
    await checkpoint({ ready: true, itemId, pendingPlacement: false });
  }
  return state;
}
