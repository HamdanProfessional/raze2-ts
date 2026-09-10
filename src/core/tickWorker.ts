/**
 * Background logic clock.
 *
 * `requestAnimationFrame` (which drives the Pixi ticker) is paused by the
 * browser whenever the tab is hidden. For online multiplayer the host must keep
 * simulating and broadcasting even when tabbed out, or every peer freezes.
 * Worker timers are NOT frozen when the page is backgrounded, so this worker
 * emits a steady heartbeat the Engine falls back to while `document.hidden`.
 */
let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent) => {
  const ms = Number(e.data) || 33;
  if (timer !== null) clearInterval(timer);
  timer = setInterval(() => (self as unknown as Worker).postMessage(0), ms);
};
