import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type Joi from 'joi';

import { CreateTaskSchema } from '../../src/schemes/tasks.schemes.js';
import {
  CreateRepeatedTaskSchema, PatchRepeatedTaskSchema,
} from '../../src/schemes/repeated-tasks.schemes.js';

/**
 * `photoUrl` is one picture for the whole task, and it validates as a link
 * because it is one. These tests pin the two halves of that: every kind of task
 * accepts it, and it is held to the same http(s) rule as everything else the
 * app opens.
 */

const PHOTO = 'https://example.com/squat.jpg';

/** A minimal valid body of each kind, before a test adds a photo to it. */
const BODIES: Record<string, object> = {
  BASIC: { type: 'BASIC', name: 'Buy a rack' },
  EVENT: { type: 'EVENT', name: 'Session', date: '2026-09-04T11:00:00.000Z' },
  DAILY: {
    type: 'DAILY',
    name: 'Stretch',
    startsAt: { hour: 9, minute: 0 },
    endsAt: { hour: 21, minute: 0 },
    repeatEach: { hour: 4, minute: 0 },
  },
  REPEATED_WEEKLY: { type: 'REPEATED_WEEKLY', name: 'Squats', weekdays: [1, 4] },
  REPEATED_MONTHLY: { type: 'REPEATED_MONTHLY', name: 'Weigh-in', fromDay: 1, months: [1, 2] },
};

const schemaFor = (type: string): Joi.Schema =>
  (type === 'BASIC' || type === 'EVENT' ? CreateTaskSchema : CreateRepeatedTaskSchema);

/** The validated body. Fails the test if the schema refused it. */
function accepted(schema: Joi.Schema, body: object): Record<string, unknown> {
  const result = schema.validate(body) as {
    error?: Joi.ValidationError;
    value: Record<string, unknown>;
  };
  assert.ok(result.error === undefined, result.error?.message ?? '');

  return result.value;
}

/** The message a body was refused with. Fails if it was accepted. */
function refusalOf(schema: Joi.Schema, body: object): string {
  const { error } = schema.validate(body) as { error?: Joi.ValidationError };
  assert.ok(error !== undefined, 'expected this body to be refused');

  return error.message;
}

describe('every kind of task takes a photo', () => {
  for (const [type, body] of Object.entries(BODIES)) {
    it(`accepts one on ${type}`, () => {
      assert.equal(accepted(schemaFor(type), { ...body, photoUrl: PHOTO })['photoUrl'], PHOTO);
    });
  }
});

describe('a task with no photo', () => {
  it('leaves the key absent rather than defaulting it', () => {
    // Absent, not null and not undefined: exactOptionalPropertyTypes, and a PUT
    // that omits it is how a photo is taken off again.
    assert.equal('photoUrl' in accepted(CreateTaskSchema, BODIES['BASIC'] ?? {}), false);
  });
});

describe('a photo is held to the same rule as a link', () => {
  const withPhoto = (photoUrl: string) => ({ ...BODIES['BASIC'], photoUrl });

  it('refuses a javascript: url', () => {
    assert.match(refusalOf(CreateTaskSchema, withPhoto('javascript:alert(1)')), /photoUrl/);
  });

  it('refuses a file: url', () => {
    assert.match(refusalOf(CreateTaskSchema, withPhoto('file:///Users/me/squat.jpg')), /photoUrl/);
  });

  it('refuses something that is not a url at all', () => {
    assert.match(refusalOf(CreateTaskSchema, withPhoto('squat.jpg')), /photoUrl/);
  });

  it('refuses one longer than 2048 characters', () => {
    const long = `https://example.com/${'a'.repeat(2048)}.jpg`;
    assert.match(refusalOf(CreateTaskSchema, withPhoto(long)), /photoUrl/);
  });

  it('accepts plain http as well as https', () => {
    assert.equal(accepted(CreateTaskSchema, withPhoto('http://example.com/a.png'))['photoUrl'],
      'http://example.com/a.png');
  });
});

describe('a patch can name the photo on its own', () => {
  it('accepts photoUrl as the only field', () => {
    assert.equal(accepted(PatchRepeatedTaskSchema, { photoUrl: PHOTO })['photoUrl'], PHOTO);
  });

  it('refuses a broken one there too', () => {
    assert.match(refusalOf(PatchRepeatedTaskSchema, { photoUrl: 'nope' }), /photoUrl/);
  });
});
