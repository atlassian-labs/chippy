import MountUnmountLab from './MountUnmountLab.jsx';

export default {
  title: 'Avalanche/MountUnmountLab',
  component: MountUnmountLab,
};

export const Default = {
  args: { count: 6 },
};

export const ManualSwap = {
  args: { count: 6, autoSwap: false },
};
