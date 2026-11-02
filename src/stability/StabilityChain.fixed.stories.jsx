import StabilityChainFixed from './StabilityChain.fixed.jsx';

export default {
  title: 'Stability/StabilityChainFixed',
  component: StabilityChainFixed,
};

// Fixed companion to StabilityChain. Use the same stability-render procedure
// against this story (--testId stability-chain-fixed) and compare the readings:
// the broken story should show commitCount > 1 with collateral, this one should
// show commitCount: 1 with zero collateral.
export const Default = {
  args: { mode: 'a' },
};
