import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskCategory } from '../../src/enum/task-category.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import type { PlanDraft } from '../../src/types/assistant.types.js';
import { InputValidationError } from '../../src/utils/http-errors/input-validation.error.js';
import { buildPayload, canonical } from '../../src/utils/plan-payload.util.js';
import { utc } from '../support/time.js';

const YEREVAN = -240;

const legPress: PlanDraft = {
  kind: TaskType.REPEATED_WEEKLY,
  name: 'Leg press – 75kg',
  category: TaskCategory.GYM,
  weekdays: [1, 4],
  times: ['06:00'],
  steps: [{ name: 'Warm-up ×12 · lighter weight' }, { name: 'Set 1 ×12' }],
  remindBeforeMins: 0,
  activeBeforeMins: 0,
  activeForMins: 960,
};

describe('buildPayload', () => {
  it('turns a gym draft into the body POST /repeated-tasks takes, in UTC', () => {
    assert.deepEqual(buildPayload(legPress, YEREVAN), {
      type: TaskType.REPEATED_WEEKLY,
      name: 'Leg press – 75kg',
      category: TaskCategory.GYM,
      links: [],
      subtasks: [{ name: 'Warm-up ×12 · lighter weight' }, { name: 'Set 1 ×12' }],
      timesOfDay: [{ hour: 2, minute: 0 }],
      weekdays: [1, 4],
      remindBeforeMins: 0,
      activeBeforeMins: 0,
      activeForMins: 960,
      enabled: true,
    });
  });

});

describe('buildPayload — weekday shift', () => {
  it('moves the weekdays back a day when the time crosses UTC midnight', () => {
    const payload = buildPayload({ ...legPress, times: ['01:00'] }, YEREVAN);
    assert.deepEqual('weekdays' in payload ? payload.weekdays : null, [0, 3]);
  });

});

describe('buildPayload — times near UTC midnight', () => {
  it('refuses times on both sides of UTC midnight on a weekly repeat', () => {
    assert.throws(
      () => buildPayload({ ...legPress, times: ['01:00', '10:00'] }, YEREVAN),
      InputValidationError,
    );
  });

  it('expands a water grid into the times it means', () => {
    const payload = buildPayload({
      kind: TaskType.REPEATED_DAILY,
      name: '💧 Drink water',
      timeGrid: { from: '09:00', until: '13:00', every: '02:00' },
      activeBeforeMins: 0,
      activeForMins: 120,
    }, YEREVAN);
    assert.deepEqual('timesOfDay' in payload ? payload.timesOfDay : null, [
      { hour: 5, minute: 0 }, { hour: 7, minute: 0 }, { hour: 9, minute: 0 },
    ]);
    assert.deepEqual('weekdays' in payload ? payload.weekdays : null, [0, 1, 2, 3, 4, 5, 6]);
  });

});

describe('buildPayload — other kinds and the existing rules', () => {
  it('makes a birthday a monthly repeat in one month', () => {
    const payload = buildPayload({
      kind: TaskType.REPEATED_MONTHLY, name: '🎂 Mother\'s birthday', dayOfMonth: 4, months: [8], times: ['10:00'],
    }, YEREVAN);
    assert.equal('fromDay' in payload ? payload.fromDay : null, 4);
  });

  it('stores an event at the instant the person meant', () => {
    const payload = buildPayload({
      kind: TaskType.EVENT, name: 'Interview', date: '2026-11-20T15:00', remindBeforeMins: 60,
    }, YEREVAN);
    assert.deepEqual('date' in payload ? payload.date : null, utc('Fri 2026-11-20 11:00'));
  });

  it('keeps the existing rule: a reminder cannot come before the task shows', () => {
    assert.throws(() => buildPayload({
      kind: TaskType.EVENT, name: 'Interview', date: '2026-11-20T15:00', remindBeforeMins: 120, activeBeforeMins: 60,
    }, YEREVAN), /remindBeforeMins/);
  });

  it('refuses a link the app would not open', () => {
    assert.throws(() => buildPayload({
      kind: TaskType.BASIC, name: 'x', links: ['javascript:alert(1)'],
    }, YEREVAN), InputValidationError);
  });
});

describe('canonical', () => {
  it('prints equal objects the same whatever their key order', () => {
    assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), canonical({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
