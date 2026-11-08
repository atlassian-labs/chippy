import FiberGrepLab from './FiberGrepLab.jsx';

export default {
  title: 'Avalanche/FiberGrepLab',
  component: FiberGrepLab,
  parameters: {
    docs: {
      description: {
        story:
          'Fixture for find-fibers --grep. Search GREP-LAB to find the issue key in props, ' +
          'hook state, a ref, class state, and (with --in debug) the IssueStore useDebugValue label.',
      },
    },
  },
};

export const Default = {};
