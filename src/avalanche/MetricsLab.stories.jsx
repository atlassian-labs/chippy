import React from 'react';
import MetricsLab, { MixedChurnLab } from './MetricsLab.jsx';

// =====================================================================
// Avalanche/MetricsLab — "lighthouse numbers" from the react-dom patch.
//
// Companion to ChurnLab. Where ChurnLab exercises Avalanche's deep,
// on-demand commit analysis, MetricsLab exercises the CHEAP counters the
// patch bumps inline: setStateCount and onHookUpdate (memo/callback/effect
// recompute). Those are cheap enough to sample on every hydration / route
// transition and forward to a dashboard — the exact use case Avalanche is
// too expensive for.
//
// Drive it with the chippy snippets (see references/hook-metrics.md):
//   hook-metrics                       # read setStateCount, NaN/wipe-safe
//   hook-tracker --action install      # own onHookUpdate
//   hook-tracker --action counts       # per component-type recompute counts
//   hook-tracker --action histogram    # DB-safe buckets
//   hook-tracker --action offenders    # dev-only, with source
// =====================================================================

export default {
  title: 'Avalanche/MetricsLab',
  component: MetricsLab,
  parameters: {
    docs: {
      description: {
        component:
          'Lighthouse-numbers demonstrator. Two bursts to measure: (1) HYDRATION — ' +
          'each widget schedules one setState after first paint; (2) TRANSITION — the ' +
          '"Transition" button bumps a key that remounts the whole widget wave, and ' +
          'each fresh widget settles again. "Churn dep" flips a memo dependency to ' +
          'produce pure memo-recompute churn with no semantic change — the classic ' +
          'unstable-identity signal, but read via cheap counters instead of a commit ' +
          'capture. Sample setStateCount before/after each burst to see the counter ' +
          'climb; install hook-tracker to attribute the memo recomputes per component.',
      },
    },
  },
};

export const Default = {
  name: 'Default (12 widgets)',
  args: { widgetCount: 12 },
};

export const HeavyHydration = {
  name: 'Heavy hydration (60 widgets)',
  args: { widgetCount: 60 },
  parameters: {
    docs: {
      description: {
        story:
          'Sixty widgets each schedule one setState on mount → a large hydration ' +
          'setStateCount delta in one wave. This is the "how many components fired ' +
          'setState during hydration" number a monitor would ship. Compare the ' +
          'setStateCount delta here vs Default: it scales linearly with widget count, ' +
          'at effectively zero measurement cost (just reading an integer).',
      },
    },
  },
};


export const MixedChurn = {
  name: 'Mixed churn (all 3 hook kinds)',
  render: (args) => <MixedChurnLab {...args} />,
  args: { widgetCount: 12 },
  parameters: {
    docs: {
      description: {
        story:
          'Each "Tick" changes the dependency of a memo, a callback, AND an effect on ' +
          'every widget at once. Install hook-tracker, click Tick a few times, then read ' +
          '`counts` — MixedChurnWidget shows non-zero memo, callback, and effect slots. ' +
          'The effect also bumps local state, so setStateCount moves too: this story is ' +
          'the one place both the cheap counter and the tracker light up together.',
      },
    },
  },
};
