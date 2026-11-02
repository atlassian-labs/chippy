import { describe, expect, it } from 'vitest';
import {
  commitSpan,
  describeCommitAction,
  groupCommitRows,
} from '../.storybook/chippy-addon/avalanche-panel-model.js';

function row(commitId: number, collateral = 8, action = 'click') {
  return {
    commitId,
    sourceCount: 2,
    stat: { collateral, effects: 1, contextUpdates: 0 },
    latestAction: {
      action,
      dom: { tag: 'button', nearestTestId: 'save' },
      targetFiber: { name: 'Button' },
    },
  };
}

describe('Chippy Storybook Avalanche panel model', () => {
  it('collapses repeated commit shapes and keeps the latest representative', () => {
    const groups = groupCommitRows([
      row(1),
      row(2),
      row(3, 3),
      row(4),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      count: 3,
      firstCommitId: 1,
      lastCommitId: 4,
      representative: { commitId: 4 },
    });
    expect(commitSpan(groups[0])).toBe('#1–#4');
  });

  it('keeps different actions and targets as different patterns', () => {
    const groups = groupCommitRows([
      row(1),
      row(2, 8, 'keydown'),
      {
        ...row(3),
        latestAction: { action: 'click', dom: { tag: 'button', nearestTestId: 'cancel' } },
      },
    ]);

    expect(groups).toHaveLength(3);
    expect(describeCommitAction(groups[0].representative)).toBe('click · cancel');
    expect(describeCommitAction({})).toBe('render');
  });
});
