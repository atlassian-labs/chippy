import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProbeAnnotationEditor } from '../.storybook/chippy-addon/probe-annotation-editor.jsx';

afterEach(cleanup);

describe('Chippy Storybook probe annotation editor', () => {
  it('commits intent on change and comment on Enter without an attach button', () => {
    const attached: unknown[] = [];
    render(
      <ProbeAnnotationEditor
        markerId="1"
        intent={null}
        comment=""
        onAttach={(annotation: unknown) => attached.push(annotation)}
      />,
    );

    fireEvent.change(screen.getByLabelText('P1 comment'), { target: { value: 'Why does this rerender?' } });
    fireEvent.change(screen.getByLabelText('P1 intent'), { target: { value: 'investigate' } });

    expect(attached).toEqual([{
      intent: 'investigate',
      comment: 'Why does this rerender?',
    }]);

    fireEvent.change(screen.getByLabelText('P1 comment'), { target: { value: 'Keep typing' } });
    fireEvent.keyDown(screen.getByLabelText('P1 comment'), { key: 'Enter', shiftKey: true });
    expect(attached).toHaveLength(1);

    fireEvent.keyDown(screen.getByLabelText('P1 comment'), { key: 'Enter' });
    expect(attached.at(-1)).toEqual({ intent: 'investigate', comment: 'Keep typing' });
    expect(screen.queryByRole('button', { name: 'Attach to P1' })).toBeNull();
  });

  it('refreshes its draft when a newer snapshot arrives', () => {
    const { rerender } = render(
      <ProbeAnnotationEditor markerId="2" intent="explain" comment="Old" onAttach={() => {}} />,
    );
    rerender(<ProbeAnnotationEditor markerId="2" intent="change" comment="New" onAttach={() => {}} />);

    expect(screen.getByLabelText('P2 intent')).toHaveValue('change');
    expect(screen.getByLabelText('P2 comment')).toHaveValue('New');
  });
});
