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

export const showcaseCover = 'OCLR · Showcase 过场';
const coverKinds = ['color_source_v3', 'color_source_v2', 'color_source'];
const coverSettings = { width: 1600, height: 800, color: 0xff281633 };
const coverTransform = { alignment: 5, positionX: 160, positionY: 100, scaleX: 1, scaleY: 1,
  rotation: 0, boundsType: 'OBS_BOUNDS_NONE', cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 };
const coverError = () => new ObsError('Showcase 遮挡未确认，请在 OBS 核对过场来源与层级，或重新设置。');
const sceneTarget = showcase => showcase.sceneUuid ? { sceneUuid: showcase.sceneUuid } : { sceneName: showcaseScene };
const topItem = items => items.every(i => Number.isInteger(i.sceneItemIndex))
  ? items.find(i => i.sceneItemIndex === items.length - 1) : items.at(-1);

function findCover(items, layer) {
  const matches = items.filter(item => item.sourceName === showcaseCover);
  if (matches.length !== 1 || (layer.inputUuid && matches[0].sourceUuid !== layer.inputUuid) ||
      (layer.ready && matches[0].sceneItemId !== layer.itemId)) throw coverError();
  return matches[0];
}

export async function installShowcaseCover(call, showcase, save) {
  const { baseWidth, baseHeight } = await call('GetVideoSettings');
  if (baseWidth !== 1920 || baseHeight !== 1080) throw new ObsError('请先将 OBS 基础画布设为 1920×1080。');
  const target = sceneTarget(showcase);
  const { inputs } = await call('GetInputList');
  const { groups } = await call('GetGroupList');
  const { scenes } = await call('GetSceneList');
  if (groups.includes(showcaseCover) || scenes.some(s => s.sceneName === showcaseCover)) throw coverError();
  const input = inputs.find(value => value.inputName === showcaseCover);
  const previous = showcase.transition;
  if (input && (!previous || !coverKinds.includes(input.inputKind) ||
      (previous.inputUuid && previous.inputUuid !== input.inputUuid))) throw coverError();
  if (!input && previous?.inputUuid && inputs.some(i => i.inputUuid === previous.inputUuid)) throw coverError();
  if (input && !previous.inputUuid) {
    const { inputSettings } = await call('GetInputSettings', { inputName: showcaseCover });
    if (!Object.entries(coverSettings).every(([key, value]) => inputSettings[key] === value)) throw coverError();
  }
  const { inputKinds } = await call('GetInputKindList');
  const kind = coverKinds.find(value => inputKinds.includes(value));
  if (!input && !kind) throw new ObsError('OBS 缺少色彩来源，无法建立 Showcase 过场。');
  await save({ ...previous, ready: false, inputUuid: input?.inputUuid ?? null });
  let { sceneItems } = await call('GetSceneItemList', target);
  if (sceneItems.filter(item => item.sourceName === showcaseCover).length > 1) throw coverError();
  if (!sceneItems.some(item => item.sourceName === showcaseCover)) {
    const result = input
      ? await call('CreateSceneItem', { ...target, sourceName: showcaseCover, sceneItemEnabled: false })
      : await call('CreateInput', { ...target, inputName: showcaseCover, inputKind: kind, inputSettings: coverSettings, sceneItemEnabled: false });
    await save({ ready: false, inputUuid: input?.inputUuid ?? result.inputUuid ?? null });
    ({ sceneItems } = await call('GetSceneItemList', target));
  }
  const layer = { ready: false, inputUuid: input?.inputUuid ?? null };
  const existing = findCover(sceneItems, layer);
  const item = { ...target, sceneItemId: existing.sceneItemId };
  await call('SetInputSettings', { inputName: showcaseCover, inputSettings: coverSettings, overlay: true });
  await call('SetSceneItemTransform', { ...item, sceneItemTransform: coverTransform });
  await call('SetSceneItemLocked', { ...item, sceneItemLocked: true });
  const complete = { ready: true, itemId: existing.sceneItemId, inputUuid: existing.sourceUuid ?? null };
  await setShowcaseCover(call, { ...showcase, transition: complete }, true, () => true);
  await save(complete);
}

// Confirm the actual OBS item, not just our requested state. OBS lists back to
// front. Recheck the index to account for captures added after configuration.
export async function setShowcaseCover(call, showcase, enabled, current) {
  const target = sceneTarget(showcase);
  const { sceneItems } = await call('GetSceneItemList', target);
  const cover = findCover(sceneItems, showcase.transition);
  const item = { ...target, sceneItemId: cover.sceneItemId };
  if (!current()) return null;
  if (enabled) {
    const [{ inputSettings }, { sceneItemTransform }] = await Promise.all([
      call('GetInputSettings', { inputName: showcaseCover }),
      call('GetSceneItemTransform', item),
    ]);
    if (!Object.entries(coverSettings).every(([key, value]) => inputSettings[key] === value) ||
        !Object.entries(coverTransform).every(([key, value]) => sceneItemTransform[key] === value)) throw coverError();
  }
  if (!current()) return null;
  if (enabled && topItem(sceneItems)?.sceneItemId !== cover.sceneItemId) {
    await call('SetSceneItemIndex', { ...item, sceneItemIndex: sceneItems.length - 1 });
  }
  if (!current()) return null;
  if (cover.sceneItemEnabled !== enabled) await call('SetSceneItemEnabled', { ...item, sceneItemEnabled: enabled });
  const { sceneItems: latest } = await call('GetSceneItemList', target);
  const confirmed = findCover(latest, showcase.transition);
  if (confirmed.sceneItemEnabled !== enabled || (enabled && topItem(latest)?.sceneItemId !== cover.sceneItemId)) throw coverError();
  return enabled;
}
