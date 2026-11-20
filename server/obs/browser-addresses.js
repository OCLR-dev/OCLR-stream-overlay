// OBS inputs are shared across scenes, so update each browser once without
// rebuilding scene items or changing their transforms, visibility or order.
export async function syncBrowserAddresses(call, overlayUrl, ports, profile, defaultPort = '3001') {
  const current = new URL(overlayUrl);
  const known = new Set([defaultPort, current.port || '80', ...ports]);
  const owned = new Set([
    ...Object.values(profile.preset?.inputIds ?? {}), profile.showcase?.inputUuid,
    profile.showcase?.transition?.artwork?.inputUuid,
  ].filter(Boolean));
  const { inputs } = await call('GetInputList', { inputKind: 'browser_source' });
  for (const input of inputs) {
    if (input.inputKind !== 'browser_source') continue;
    const target = input.inputUuid ? { inputUuid: input.inputUuid } : { inputName: input.inputName };
    const { inputSettings } = await call('GetInputSettings', target);
    let url;
    try { url = new URL(inputSettings.url); } catch { continue; }
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.username || url.password || !['/overlay', '/showcase'].includes(url.pathname) ||
        (!known.has(url.port || '80') && !owned.has(input.inputUuid))) continue;
    if (url.port !== current.port) {
      url.port = current.port;
      await call('SetInputSettings', { ...target, inputSettings: { url: url.href }, overlay: true });
    }
    const artwork = profile.showcase?.transition?.artwork;
    if (input.inputUuid && input.inputUuid === artwork?.inputUuid) {
      // Migrate only the expected port. A manually changed output path/query
      // must still fail coverage validation rather than becoming trusted here.
      const expected = new URL(artwork.url);
      expected.port = current.port;
      artwork.url = expected.href;
    }
  }
}
