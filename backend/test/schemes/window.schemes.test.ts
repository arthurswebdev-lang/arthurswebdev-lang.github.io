import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type Joi from 'joi';

import {
  DEFAULT_ACTIVE_BEFORE_MINS, DEFAULT_ACTIVE_FOR_MINS, DEFAULT_REMIND_BEFORE_MINS,
} from '../../src/schemes/common.schemes.js';
import { CreateTaskSchema } from '../../src/schemes/tasks.schemes.js';
import { CreateRepeatedTaskSchema } from '../../src/schemes/repeated-tasks.schemes.js';
import type { TaskWindow } from '../../src/types/tasks.types.js';

/** A valid body for each resource, before a test bends one field of it. */
const anEventBody = (window: Record<string, number> = {}) => ({
  type: 'EVENT', name: 'Interview', date: '2026-09-04T11:00:00.000Z', ...window,
});

const aWeeklyBody = (window: Record<string, number> = {}) => ({
  type: 'REPEATED_WEEKLY', name: 'Gym', weekdays: [1, 4], ...window,
});

/** Validates and hands back just the window, typed. Fails if the body is not. */
function windowFrom(schema: Joi.Schema, body: object): TaskWindow {
  const result = schema.validate(body) as { error?: Joi.ValidationError; value: TaskWindow };
  assert.ok(result.error === undefined, result.error?.message ?? '');

  const { remindBeforeMins, activeBeforeMins, activeForMins } = result.value;

  return { remindBeforeMins, activeBeforeMins, activeForMins };
}

/** The message a body was rejected with. Fails if it was accepted. */
function refusalOf(schema: Joi.Schema, body: object): string {
  const { error } = schema.validate(body) as { error?: Joi.ValidationError };
  assert.ok(error !== undefined, 'expected this body to be refused');

  return error.message;
}

const DEFAULTS: TaskWindow = {
  remindBeforeMins: DEFAULT_REMIND_BEFORE_MINS,
  activeBeforeMins: DEFAULT_ACTIVE_BEFORE_MINS,
  activeForMins: DEFAULT_ACTIVE_FOR_MINS,
};

describe('the window fields on an event', () => {
  it('fills in all three when the client sends none', () => {
    assert.deepEqual(windowFrom(CreateTaskSchema, anEventBody()), DEFAULTS);
  });

  it('accepts the interview: remind 10, visible from 60 before, spent 180 after', () => {
    const window = { remindBeforeMins: 10, activeBeforeMins: 60, activeForMins: 180 };

    assert.deepEqual(windowFrom(CreateTaskSchema, anEventBody(window)), window);
  });

  it('accepts zero for both "before" fields — remind me exactly on time', () => {
    const window = windowFrom(CreateTaskSchema, anEventBody({
      remindBeforeMins: 0, activeBeforeMins: 0,
    }));

    assert.equal(window.remindBeforeMins, 0);
    assert.equal(window.activeBeforeMins, 0);
  });

  it('refuses a zero activeFor, which would pass the instant it arrived', () => {
    assert.match(refusalOf(CreateTaskSchema, anEventBody({ activeForMins: 0 })), /activeForMins/);
  });
});

describe('a reminder cannot arrive before the task is visible', () => {
  const tooEager = { remindBeforeMins: 120, activeBeforeMins: 60 };

  it('refuses remindBefore longer than activeBefore on an event', () => {
    assert.match(refusalOf(CreateTaskSchema, anEventBody(tooEager)), /still hidden under upcoming/);
  });

  it('refuses it on a repeated config too', () => {
    assert.match(
      refusalOf(CreateRepeatedTaskSchema, aWeeklyBody(tooEager)),
      /still hidden under upcoming/,
    );
  });

  it('allows the two being equal — announced the moment it appears', () => {
    const window = windowFrom(CreateTaskSchema, anEventBody({
      remindBeforeMins: 60, activeBeforeMins: 60,
    }));

    assert.equal(window.remindBeforeMins, 60);
  });

  it('checks against the filled-in default, not only against what was sent', () => {
    // A lead longer than the default `activeBefore`, with `activeBefore` itself
    // left unsaid. This is the case a sibling ref would have missed: it
    // resolves against the raw body, where the key is simply absent.
    const body = anEventBody({ remindBeforeMins: DEFAULT_ACTIVE_BEFORE_MINS + 1 });

    assert.match(refusalOf(CreateTaskSchema, body), /still hidden under upcoming/);
  });
});

describe('a config carries the same window as an event', () => {
  it('defaults all three on a weekly config', () => {
    assert.deepEqual(windowFrom(CreateRepeatedTaskSchema, aWeeklyBody()), DEFAULTS);
  });

  it('lets a gym split ask to be shown only on the day', () => {
    const window = windowFrom(CreateRepeatedTaskSchema, aWeeklyBody({
      activeBeforeMins: 0, activeForMins: 240,
    }));

    assert.equal(window.activeBeforeMins, 0);
  });
});
