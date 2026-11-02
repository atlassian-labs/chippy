// Page globals the plain-JavaScript extension scripts share. Used only for
// type checking (tsconfig.helper.json); nothing here ships.

/** The page runtime object at `window.__CHIPPY`. Its members are installed by several scripts. */
interface ChippyPageRuntime {
  config?: Record<string, any>;
  connState?: string | null;
  pageBridge?: { version?: string; destroy?: () => void; [key: string]: any };
  layoutLab?: Record<string, any>;
  [key: string]: any;
}

interface Window {
  __CHIPPY?: ChippyPageRuntime;
  __AVALANCHE__?: Record<string, any>;
  __CHIPPY_OWNER__?: Record<string, any>;
  __CHIPPY_OWNER_RESULT__?: unknown;
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: Record<string, any>;
}
