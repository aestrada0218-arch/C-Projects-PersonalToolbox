// Refresh the current view without remounting it or replacing open form drafts.
export function listenForDataChanges(load: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(load, 50);
  };
  const visible = () => {
    if (!document.hidden) refresh();
  };
  const unsubscribe = window.toolbox?.onDataChanged?.(refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", visible);
  return () => {
    clearTimeout(timer);
    unsubscribe?.();
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", visible);
  };
}
