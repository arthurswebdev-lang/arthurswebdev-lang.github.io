import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActiveLogic } from '../../src/enum/active-logic.enum.js';
import { assertTaskReplaceAllowed } from '../../src/rules/task-update.rules.js';
import { aBasicTask, aHandMadeEvent, aWeeklyEvent } from '../support/tasks.js';

describe('PUT on a generated event is refused outright', () => {
  const generated = aWeeklyEvent('gym', 'Mon 2026-08-24 09:00');

  it('refuses the replacement whatever the payload says', () => {
    assert.throws(
      () => { assertTaskReplaceAllowed(generated); },
      /A generated event cannot be replaced/,
    );
  });

  it('points at the status endpoint and at the config', () => {
    assert.throws(
      () => { assertTaskReplaceAllowed(generated); },
      /PATCH \/tasks\/:id\/status/,
    );
  });

  it('names the config it came from', () => {
    assert.throws(
      () => { assertTaskReplaceAllowed(generated); },
      new RegExp(String(generated.configTaskId)),
    );
  });
});

describe('PUT still works where no config stands behind the task', () => {
  it('allows replacing a hand-made event', () => {
    const byHand = aHandMadeEvent('dentist', '2026-08-24 09:00', ActiveLogic.TODAY);

    assert.doesNotThrow(() => { assertTaskReplaceAllowed(byHand); });
  });

  it('allows replacing a basic task', () => {
    assert.doesNotThrow(() => { assertTaskReplaceAllowed(aBasicTask('buy milk')); });
  });
});
