import { ObsError } from './socket.js';

const sourceName = 'OCLR · 直播间弹幕';
// Inside the 420×138 STREAM CHAT fieldset on the 1920×1080 broadcast canvas.
const width = 398;
const height = 112;
const transform = { alignment: 5, positionX: 1481, positionY: 950, scaleX: 1, scaleY: 1, boundsType: 'OBS_BOUNDS_NONE' };
const legacyCss = `html, body, #app, yt-live-chat-renderer { background: transparent !important; margin: 0; overflow: hidden; }
yt-live-chat-renderer { --yt-live-chat-background-color: transparent; }
yt-live-chat-ticker-renderer, #author-photo { display: none !important; }
yt-live-chat-text-message-renderer { padding: 0 2px !important; }
#author-name, #message { font: 600 16px/21px sans-serif !important; text-shadow: 0 1px 2px #140c24; }
#author-name { color: #dac1ff !important; }
#message { color: #faf6ff !important; font-weight: 400 !important; }`;
// Hide the inner scroller's native track without disabling automatic message scrolling.
const css = `${legacyCss}
yt-live-chat-renderer { --scrollbar-width: 0px !important; }
#item-scroller { scrollbar-width: none !important; padding-right: 0 !important; }
::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }`;

export function chatIdentityCode(value) {
  const code = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9A-Z]{12,14}$/.test(code)) throw new ObsError('请粘贴完整的直播身份码，由 12 至 14 位大写字母或数字组成。');
  return code;
}

function roomUrl(code) {
  return `https://blive.chat/room/${chatIdentityCode(code)}?roomKeyType=2`;
}

export async function ensureStreamChat(call, profile, save) {
  let chat = { ...profile.streamChat, items: { ...profile.streamChat.items } };
  const url = roomUrl(chat.code);
  const checkpoint = async change => {
    chat = { ...chat, ...change };
    await save(chat);
  };
  const { inputs } = await call('GetInputList');
  let input = chat.uuid && inputs.find(item => item.inputUuid === chat.uuid);
  if (!input) {
    input = inputs.find(item => item.inputName === (chat.name || sourceName));
    if (input && (chat.uuid || !chat.name)) {
      throw new ObsError('直播间弹幕来源名称已被占用，请在 OBS 给同名来源改名后重试。');
    }
  }
  if (input && input.inputKind !== 'browser_source') throw new ObsError('直播间弹幕需要浏览器源，请在 OBS 核对同名来源。');
  const name = input?.inputName || chat.name || sourceName;
  const scenes = [];
  for (const layout of ['regular', 'ex']) {
    const sceneName = profile[layout];
    const sceneUuid = profile.sceneIds?.[layout] || null;
    const target = sceneUuid ? { sceneUuid } : { sceneName };
    const { sceneItems } = await call('GetSceneItemList', target);
    const matches = sceneItems.filter(i => i.sourceName === name);
    if (matches.length > 1) throw new ObsError(`「${sceneName}」里有多个直播间弹幕场景项，请在 OBS 保留一项后重试。`);
    scenes.push({ scene: sceneUuid || sceneName, target, item: matches[0] });
  }
  if (input) {
    const { inputSettings } = await call('GetInputSettings', { inputName: name });
    // Without an OBS UUID, verify the saved source (including creation whose reply was lost).
    const knownItem = scenes.some(({ scene, item }) => item && chat.items[scene]?.id === item.sceneItemId);
    const hasPresetSettings = [css, legacyCss].includes(inputSettings.css) && /^https:\/\/blive\.chat\/room\/[0-9A-Z]{12,14}\?roomKeyType=2$/.test(inputSettings.url);
    if (!chat.uuid && !knownItem && !hasPresetSettings) {
      throw new ObsError('原直播间弹幕来源已被替换，请在 OBS 核对来源名称后重试。');
    }
    const updates = {};
    if (inputSettings.url !== url) updates.url = url;
    // Upgrade only our original preset; retain CSS customized by the operator.
    if (inputSettings.css === legacyCss) updates.css = css;
    if (Object.keys(updates).length) await call('SetInputSettings', { inputName: name, inputSettings: updates, overlay: true });
  } else {
    const { groups } = await call('GetGroupList');
    const { scenes: allScenes } = await call('GetSceneList');
    if (groups.includes(name) || allScenes.some(s => s.sceneName === name)) throw new ObsError('直播间弹幕来源名称已被占用，请在 OBS 改名后重试。');
  }
  for (const { scene, target, item } of scenes) {
    if (item && chat.items[scene]?.id === item.sceneItemId) continue;
    let id = item?.sceneItemId;
    if (!input) {
      // Persist intent before creation. A timeout may mean OBS created the input already.
      await checkpoint({ name, uuid: null, items: {} });
      const result = await call('CreateInput', { ...target, inputName: name, inputKind: 'browser_source',
        inputSettings: { url, width, height, css, shutdown: false, restart_when_active: false }, sceneItemEnabled: false });
      input = { inputName: name, inputUuid: result.inputUuid };
      id = result.sceneItemId;
      await checkpoint({ uuid: result.inputUuid || null });
    } else if (!item) {
      const source = input.inputUuid ? { sourceUuid: input.inputUuid } : { sourceName: name };
      const added = await call('CreateSceneItem', { ...target, ...source, sceneItemEnabled: false });
      id = added.sceneItemId;
    }
    const placed = { ...target, sceneItemId: id };
    await call('SetSceneItemTransform', { ...placed, sceneItemTransform: transform });
    // OBS creates scene items at the top. An interrupted creation may have left it below the overlay.
    const { sceneItems } = await call('GetSceneItemList', target);
    await call('SetSceneItemIndex', { ...placed, sceneItemIndex: sceneItems.length - 1 });
    await call('SetSceneItemLocked', { ...placed, sceneItemLocked: true });
    await call('SetSceneItemEnabled', { ...placed, sceneItemEnabled: true });
    await checkpoint({ items: { ...chat.items, [scene]: { id } } });
  }
  if (chat.pending || chat.name !== name || chat.uuid !== (input.inputUuid || null)) {
    await checkpoint({ name, uuid: input.inputUuid || null, pending: false });
  }
}
