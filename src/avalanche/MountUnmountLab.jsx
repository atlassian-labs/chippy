// Tiny lab story to provoke deterministic unmounts during initial mount.
// Designed for verifying reload-with-avalanche capture quality:
//   - First commit mounts <Initial /> children.
//   - useEffect fires immediately -> setState swaps to <Replacement /> children.
//   - The swap unmounts every <Initial> child (keys differ from <Replacement>).
// Result: a known number of `unmountedComponents` and `unmountedSubtrees`
// in commit 2 (or 3, depending on when the detector hooks in).

import React from 'react';

function Initial({ id }) {
  return <li data-kind="initial">Initial {id}</li>;
}

function Replacement({ id }) {
  return <li data-kind="replacement">Replacement {id}</li>;
}

export default function MountUnmountLab({ count = 6, autoSwap = true, swapDelayMs = 50 }) {
  const [phase, setPhase] = React.useState('initial');

  React.useEffect(() => {
    if (!autoSwap) return undefined;
    // Defer one paint then trigger the swap, so the initial mount commits first.
    const timer = setTimeout(() => setPhase('replacement'), swapDelayMs);
    return () => clearTimeout(timer);
  }, [autoSwap, swapDelayMs]);

  // Expose a manual trigger so tests can drive the swap on demand AFTER
  // installing the avalanche detector.
  React.useEffect(() => {
    window.__mountUnmountLabSwap = () => setPhase('replacement');
    window.__mountUnmountLabReset = () => setPhase('initial');
    return () => {
      delete window.__mountUnmountLabSwap;
      delete window.__mountUnmountLabReset;
    };
  }, []);

  const ids = Array.from({ length: count }, (_, i) => i);

  return (
    <div data-testid="mount-unmount-lab">
      <p>phase: {phase}</p>
      <ul>
        {phase === 'initial'
          ? ids.map((id) => <Initial key={`initial-${id}`} id={id} />)
          : ids.map((id) => <Replacement key={`replacement-${id}`} id={id} />)}
      </ul>
    </div>
  );
}
