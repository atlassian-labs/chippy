import ChurnLab, {
  UnstableProviderLab,
  EffectAvalancheLab,
  MixedStabilityLab,
} from './ChurnLab.jsx';

export default {
  title: 'Avalanche/ChurnLab',
  component: ChurnLab,
};

export const Default = {
  args: { consumerCount: 8, tickMs: 50 },
};

export const HeavyChurn = {
  args: { consumerCount: 30, tickMs: 25 },
};

export const DebugHookLab = {
  name: 'Hook chain walkthrough',
  args: { consumerCount: 1, tickMs: 250, storeIntervalMs: 0 },
  parameters: {
    docs: {
      description: {
        story:
          'Minimal fixture for debug-render exploration. StoreReader contains a ' +
          'small custom-hook chain with several memoized derived values. Start ' +
          'from the suspicious hook index reported by debug-render, ' +
          'then use debugHook primitive + parent order to walk from the known ' +
          'StoreReader source location into the matching custom hook.',
      },
    },
  },
};

// =====================================================================
// Example A — Unstable provider reference
// =====================================================================
export const UnstableProvider = {
  name: 'A · Unstable provider',
  render: (args) => <UnstableProviderLab {...args} />,
  args: { consumerCount: 8, tickMs: 200 },
  parameters: {
    docs: {
      description: {
        story:
          "Provider builds a fresh `value={{ counter, label }}` object on every render. " +
          "Counter is held constant by useState — so any consumer churn observed in the " +
          "report is a pure value-identity artefact, not a semantic change. " +
          "Detection: `report.contextUpdates['UnstableCtx'].count` should match the " +
          "number of parent commits, and prev/new values JSON-diff to nothing. " +
          "This is the cleanest signal of an unstable provider reference; the actual " +
          "remedy (memo, split, hoist, ref-equal value, etc.) is an agent decision.",
      },
    },
  },
};

// =====================================================================
// Example B — Context value updated in useEffect
// =====================================================================
export const EffectAvalanche = {
  name: 'B · Effect-driven context update',
  render: (args) => <EffectAvalancheLab {...args} />,
  args: { consumerCount: 8, tickMs: 250 },
  parameters: {
    docs: {
      description: {
        story:
          "Provider stores a derived value in local state and writes it from " +
          "`useEffect(..., [tick])`. Each external tick produces TWO commits: " +
          "the first with the stale value, the second post-effect. " +
          "Detection: `contextUpdates['EffectCtx'].count ≈ 2× external ticks`, " +
          "paired commits in `contextUpdatesByCommit`, and the on-screen counter " +
          "shows ~2× ticks. " +
          "This pattern is intentionally ambiguous — there is no canonical fix. " +
          "The agent must reason about *what the value represents* (pure derivation, " +
          "external snapshot, settings, cross-provider race) and choose between " +
          "computing in render, switching to useSyncExternalStore / a subscription, " +
          "exposing getters, or redesigning the data flow. Do not auto-suggest a memo.",
      },
    },
  },
};

// =====================================================================
// Example C — Mixed-stability context
// =====================================================================
export const MixedStability = {
  name: 'C · Mixed-stability context',
  render: (args) => <MixedStabilityLab {...args} />,
  args: { consumerCount: 6, tickMs: 200 },
  parameters: {
    docs: {
      description: {
        story:
          "One provider mixes a stable callback (`onAction`, created once via ref) " +
          "with a volatile field (`hover`). Both `StableReader` and `VolatileReader` " +
          "consume the merged value. " +
          "Detection: `contextUpdates['MixedCtx']` ticks with hover; the prev/new " +
          "diff touches only the `hover` field, but `sourcesByCommit` lists both " +
          "consumer kinds — proving stable-only readers were dragged in by the merge. " +
          "Remedy is a design choice (split context, getters, move volatile half out " +
          "of context). Agent decides.",
      },
    },
  },
};
