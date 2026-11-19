import { onMounted, onUnmounted, ref } from 'vue';

export async function streamingRequest(input: Record<string, unknown>) {
  const response = await fetch('/api/streaming', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input), credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || '操作失败，请重试');
  return result;
}

export function useStreamingLogin(onConnected: () => void = () => {}, acceptStatus: (status: string) => boolean = status => status === 'ready') {
  const pending = ref(false);
  const pendingAction = ref('');
  const message = ref('');
  let popup: Window | null = null;
  let handoff: { state: string; edition: string; websiteOrigin: string } | null = null;
  let popupTimer: ReturnType<typeof setInterval> | undefined;
  let handoffDeadline = 0;
  function stopPopup() { clearInterval(popupTimer); popupTimer = undefined; handoff = null; popup?.close(); popup = null; }
  async function login(edition: string) {
    stopPopup();
    popup = window.open('about:blank', 'oclr-streaming-login', 'popup,width=620,height=760');
    if (!popup) { message.value = '登录窗口被拦截，请允许弹出窗口，或使用手动复制授权。'; return; }
    pendingAction.value = 'login'; pending.value = true; message.value = '请在 OCLR 网站登录并授权。';
    try {
      const result = await streamingRequest({ action: 'authorize', edition });
      if (!popup) return;
      handoff = { state: result.state, edition: result.edition, websiteOrigin: new URL(result.authorizationUrl).origin };
      popup.location.href = result.authorizationUrl;
      handoffDeadline = Date.now() + 600000;
      popupTimer = setInterval(() => {
        if (!popup || popup.closed || Date.now() >= handoffDeadline) {
          stopPopup(); pending.value = false; message.value = '登录已取消或超时，可以重新登录；手动复制授权仍可使用。';
        }
      }, 1000);
    } catch (error) { stopPopup(); pending.value = false; message.value = error instanceof Error ? error.message : '无法打开登录，请重试'; }
  }
  async function receive(event: MessageEvent) {
    const active = handoff;
    if (!active || !popup || event.source !== popup || event.origin !== active.websiteOrigin ||
      event.data?.state !== active.state || event.data?.edition !== active.edition) return;
    if (event.data.type === 'oclr-streaming-ready') {
      popup.postMessage({ type: 'oclr-streaming-hello', state: active.state }, active.websiteOrigin); return;
    }
    if (event.data.type !== 'oclr-streaming-token' || typeof event.data.token !== 'string') return;
    handoff = null; clearInterval(popupTimer);
    pendingAction.value = 'connect';
    try {
      const result = await streamingRequest({ action: 'complete-authorization', state: active.state, edition: active.edition, token: event.data.token });
      if (!acceptStatus(result.status)) throw new Error('已收到授权，但连接未完成，请核对网站权限后重试。');
      popup?.postMessage({ type: 'oclr-streaming-connected', state: active.state }, active.websiteOrigin);
      message.value = '已登录 OCLR。';
      popup = null;
      onConnected();
    } catch (error) { message.value = error instanceof Error ? error.message : '自动连接失败，可以使用手动复制授权。'; }
    finally { pending.value = false; }
  }
  onMounted(() => window.addEventListener('message', receive));
  onUnmounted(() => { window.removeEventListener('message', receive); stopPopup(); });
  return { pending, pendingAction, message, login, stopPopup };
}
