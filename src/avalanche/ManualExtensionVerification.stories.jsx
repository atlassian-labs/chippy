import ManualExtensionVerification from './ManualExtensionVerification.jsx';

export default {
  title: 'Avalanche/ManualExtensionVerification',
  component: ManualExtensionVerification,
  parameters: {
    docs: {
      description: {
        story:
          'Manual Chippy extension verification fixture. Use find-fibers --prop onClick ' +
          'against the buttons to verify fiber-prop-contract and fiber-invoke, including a synthetic event. ' +
          'Arm Avalanche in full mode, click "trigger trasher", then run commit-peek ' +
          'include=stats,sources,rendered to inspect propChanges and trasherCounts.',
      },
    },
  },
};

export const Default = {};
