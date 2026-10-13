// -----------------------------------------------------------------------------
// ProblemLog: one line when a problem starts or changes, one when it ends.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProblemLog } from '../src/problems.js';

function recorder() {
  const lines = [];
  const log = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    log[level] = (message) => lines.push([level, message]);
  }
  return { lines, log };
}

test('a repeated failure is logged once, then at debug', () => {
  const { lines, log } = recorder();
  const problems = new ProblemLog(log);
  assert.equal(problems.fail('states', 'States refused: HTTP 500'), true);
  assert.equal(problems.fail('states', 'States refused: HTTP 500'), false);
  assert.equal(problems.fail('states', 'States refused: HTTP 500'), false);
  assert.deepEqual(lines, [
    ['warn', 'States refused: HTTP 500'],
    ['debug', 'States refused: HTTP 500'],
    ['debug', 'States refused: HTTP 500'],
  ]);
});

test('a new message is logged again; keys are independent; the level is chosen', () => {
  const { lines, log } = recorder();
  const problems = new ProblemLog(log);
  problems.fail('states', 'States refused: HTTP 500');
  problems.fail('states', 'States refused: HTTP 503');
  problems.fail('poll', 'Poll failed: boom', 'error');
  assert.deepEqual(lines, [
    ['warn', 'States refused: HTTP 500'],
    ['warn', 'States refused: HTTP 503'],
    ['error', 'Poll failed: boom'],
  ]);
});

test('the recovery is logged once, only after a failure', () => {
  const { lines, log } = recorder();
  const problems = new ProblemLog(log);
  assert.equal(problems.recover('states', 'States accepted again'), false);
  problems.fail('states', 'States refused: HTTP 500');
  assert.equal(problems.recover('states', 'States accepted again'), true);
  assert.equal(problems.recover('states', 'States accepted again'), false);
  problems.fail('states', 'States refused: HTTP 500');
  assert.deepEqual(lines, [
    ['warn', 'States refused: HTTP 500'],
    ['info', 'States accepted again'],
    ['warn', 'States refused: HTTP 500'],
  ]);
});

test('a recovery without message ends the problem silently', () => {
  const { lines, log } = recorder();
  const problems = new ProblemLog(log);
  problems.fail('k', 'failed');
  assert.equal(problems.recover('k'), true);
  assert.deepEqual(lines, [['warn', 'failed']]);
});
