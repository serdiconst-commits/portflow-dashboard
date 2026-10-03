// Native, non-passive listeners let iOS cancel scrolling before it takes over
// the signature gesture. Only touches beginning inside this surface are handled.
export function bindIosSignatureTouch(surface, { disabled, start, move }) {
  let activeId = null;
  const point = touch => {
    const rect = surface.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height)),
    };
  };
  const prevent = event => { if (event.cancelable) event.preventDefault(); };
  const onStart = event => {
    if (disabled()) return;
    prevent(event);
    if (activeId !== null) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    activeId = touch.identifier;
    start(point(touch));
  };
  const onMove = event => {
    if (activeId === null) return;
    prevent(event);
    if (disabled()) { activeId = null; return; }
    const touch = Array.from(event.changedTouches).find(t => t.identifier === activeId);
    if (touch) move(point(touch));
  };
  const onEnd = event => {
    if (activeId === null) return;
    prevent(event);
    if (Array.from(event.changedTouches).some(t => t.identifier === activeId)) activeId = null;
  };
  const handlers = { touchstart: onStart, touchmove: onMove, touchend: onEnd, touchcancel: onEnd };
  for (const [type, handler] of Object.entries(handlers)) surface.addEventListener(type, handler, { passive: false });
  return () => {
    activeId = null;
    for (const [type, handler] of Object.entries(handlers)) surface.removeEventListener(type, handler);
  };
}
