import React from 'react';
import { LayoutPlayground } from './LayoutPlayground';
import { defaultLayoutItems } from './defaultLayout';

export default {
  title: 'Labs/LayoutPlayground',
  component: LayoutPlayground,
};

export const Default = {
  args: {
    items: defaultLayoutItems,
    columns: 2,
  },
  render: (args) => <LayoutPlayground {...args} />,
};
