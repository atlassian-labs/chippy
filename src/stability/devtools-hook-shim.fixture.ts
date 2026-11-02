// Side-effect module: install the devtools hook shim. Imported FIRST (before any
// react-dom import) so react-dom registers its renderer into hook.renderers at
// module-evaluation time. ESM evaluates imports in source order, so importing
// this module above 'react'/'react-dom' guarantees the hook exists first.
const g = globalThis as any;
if (!g.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
  const renderers = new Map<number, any>();
  g.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    __chippyShim: true,
    supportsFiber: true,
    renderers,
    inject(renderer: any) {
      const id = (renderers.size || 0) + 1;
      renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  };
}
export {};
