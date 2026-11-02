import StabilityChain from './StabilityChain.jsx';

export default {
  title: 'Stability/StabilityChain',
  component: StabilityChain,
};

// Default — broken chain: object literal in render → unstable memo →
// unstable useCallback → useEffect re-fires every commit → setState in effect
// → cascade.
//
// Use with the stability-render sub-skill:
//   chippy.sh avalanche-arm <clientId> <origin>
//   chippy.sh avalanche-clear <clientId>
//   chippy.sh eval-page <clientId> stability-nudge --probeId 1 --label parent-nudge
//   sleep 1
//   chippy.sh avalanche-status <clientId>
//   chippy.sh avalanche-hot-sources <clientId> 12
export const Default = {
  args: { mode: 'a' },
};
