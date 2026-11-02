/* eslint-disable */

function buildFiberStateCaptureCommand(body = {}) {
  return {
    type: 'capture-fiber-state',
    options: { maxFibers: body.maxFibers },
  };
}

function buildFiberStateCompareCommand(before, after, body = {}) {
  return {
    type: 'compare-fiber-states',
    before,
    after,
    options: { maxChanges: body.maxChanges },
  };
}

module.exports = { buildFiberStateCaptureCommand, buildFiberStateCompareCommand };
