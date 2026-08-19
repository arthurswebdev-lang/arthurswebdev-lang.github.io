import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActiveLogic } from '../../src/enum/active-logic.enum.js';
import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import {
  assertRepeatedTaskUpdateAllowed,
  assertTaskUpdateAllowed,
  isStatusOnlyUpdate,
  protectedFieldsChanged,
} from '../../src/rules/task-update.rules.js';
import type {
  CreateEventTask, RepeatedTask, UpdateTask,
} from '../../src/types/tasks.types.js';
import { aBasicTask, aHandMadeEvent, aWeeklyConfig, aWeeklyEvent } from '../support/tasks.js';
import { utc } from '../support/time.js';

/** The stored event, as generated from a weekly config. */
const generated = aWeeklyEvent('gym', 'Mon 2026-08-24 09:00');

/** The same event echoed back unchanged, as a client would send it. */
const unchanged = (): CreateEventTask => ({
  type: TaskType.EVENT,
  name: generated.name,
  status: generated.status,
  date: generated.date,
  subtasks: [],
  activeLogic: generated.activeLogic,
});

describe('a generated event accepts a status change', () => {
  it('allows marking it done', () => {
    const changes = { ...unchanged(), status: TaskStatus.DONE } as UpdateTask;

    assert.equal(isStatusOnlyUpdate(generated, changes), true);
    assert.doesNotThrow(() => { assertTaskUpdateAllowed(generated, changes); });
  });

  it('allows an echo of the stored values with nothing changed', () => {
    assert.doesNotThrow(() => { assertTaskUpdateAllowed(generated, unchanged()); });
  });
});

describe('a generated event refuses everything else', () => {
  it('refuses a rename and says where to change it', () => {
    const changes = { ...unchanged(), name: 'gym harder' } as UpdateTask;

    assert.throws(
      () => { assertTaskUpdateAllowed(generated, changes); },
      /only accepts status changes; name must be changed on its repeated task/,
    );
  });

  it('refuses a new date', () => {
    const changes = { ...unchanged(), date: utc('Tue 2026-08-25 09:00') } as UpdateTask;

    assert.deepEqual(protectedFieldsChanged(generated, changes as CreateEventTask), ['date']);
    assert.throws(() => { assertTaskUpdateAllowed(generated, changes); });
  });

});

describe('a generated event refuses several changes at once', () => {
  it('refuses added subtasks and a changed active logic, listing both', () => {
    const changes = {
      ...unchanged(),
      activeLogic: ActiveLogic.TODAY,
      subtasks: [{ name: 'stretch' }],
    } as UpdateTask;

    assert.deepEqual(
      protectedFieldsChanged(generated, changes as CreateEventTask),
      ['activeLogic', 'subtasks'],
    );
  });

  it('refuses an omitted activeLogic, since PUT would reset it', () => {
    const echoed = unchanged();
    delete echoed.activeLogic;

    assert.throws(() => { assertTaskUpdateAllowed(generated, echoed); });
  });
});

describe('a hand-made event is unaffected', () => {
  const byHand = aHandMadeEvent('dentist', '2026-08-24 09:00', ActiveLogic.TODAY);

  it('takes a full replacement, because there is no config to edit instead', () => {
    const changes = {
      type: TaskType.EVENT,
      name: 'dentist, rescheduled',
      date: utc('2026-08-25 11:00'),
      subtasks: [],
      activeLogic: ActiveLogic.TODAY,
    } as UpdateTask;

    assert.doesNotThrow(() => { assertTaskUpdateAllowed(byHand, changes); });
  });
});

describe('a basic task is unaffected', () => {
  it('takes a full replacement', () => {
    const changes = { type: TaskType.BASIC, name: 'buy oat milk', subtasks: [] } as UpdateTask;

    assert.doesNotThrow(() => { assertTaskUpdateAllowed(aBasicTask('buy milk'), changes); });
  });
});

describe("a config's status is fixed", () => {
  const config: RepeatedTask = aWeeklyConfig('gym', [1, 5]);

  it('allows an edit that leaves status alone', () => {
    assert.doesNotThrow(() => {
      assertRepeatedTaskUpdateAllowed(config, {
        type: TaskType.REPEATED_WEEKLY, name: 'gym harder', weekdays: [1, 3, 5],
      });
    });
  });

  it('allows a payload that omits status entirely', () => {
    assert.doesNotThrow(() => {
      assertRepeatedTaskUpdateAllowed(config, {
        type: TaskType.REPEATED_WEEKLY, name: 'gym', weekdays: [1],
      });
    });
  });

});

describe("a config's status change is refused", () => {
  const config: RepeatedTask = aWeeklyConfig('gym', [1, 5]);

  it('refuses a status change and says what to do instead', () => {
    assert.throws(
      () => {
        assertRepeatedTaskUpdateAllowed(config, {
          type: TaskType.REPEATED_WEEKLY, name: 'gym', status: TaskStatus.DONE, weekdays: [1, 5],
        });
      },
      /status cannot be changed; it is a rule, not a to-do/,
    );
  });
});
