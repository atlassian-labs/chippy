import React from 'react';
import { HelloButton } from './HelloButton';

export default {
  title: 'Components/HelloButton',
  component: HelloButton,
};

export const Default = {
  args: {
    label: 'Hello words',
  },
  render: (args) => <HelloButton {...args} />,
};
