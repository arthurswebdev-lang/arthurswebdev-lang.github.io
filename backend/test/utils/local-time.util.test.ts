import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeNow, expandGrid, localDateToUtc, parseClock, toUtcTime,
} from '../../src/utils/local-time.util.js';
import { utc } from '../support/time.js';

/** Yerevan is UTC+4, so the browser reports -240. */
const YEREVAN = -240;
/** Kathmandu is UTC+05:45: a half-hour bug fails here. */
const KATHMANDU = -345;
/** New York in winter is UTC-5. */
const NEW_YORK = 300;

describe('parseClock', () => {
  it('reads a 24-hour clock', () => {
    assert.equal(parseClock('06:00'), 360);
    assert.equal(parseClock('9:30'), 570);
    assert.equal(parseClock('23:59'), 1439);
  });

  it('refuses what is not a clock time', () => {
    assert.equal(parseClock('24:00'), null);
    assert.equal(parseClock('7 pm'), null);
    assert.equal(parseClock('12:60'), null);
  });
});

describe('toUtcTime', () => {
  it('moves a Yerevan morning back four hours on the same day', () => {
    assert.deepEqual(toUtcTime(12 * 60, YEREVAN), { time: { hour: 8, minute: 0 }, dayShift: 0 });
  });

  it('moves an early-morning time to the day before — the trap', () => {
    assert.deepEqual(toUtcTime(60, YEREVAN), { time: { hour: 21, minute: 0 }, dayShift: -1 });
  });

  it('keeps the minutes of a non-whole-hour offset', () => {
    assert.deepEqual(toUtcTime(9 * 60, KATHMANDU), { time: { hour: 3, minute: 15 }, dayShift: 0 });
  });

  it('moves a late evening west of UTC to the next day', () => {
    assert.deepEqual(toUtcTime(22 * 60, NEW_YORK), { time: { hour: 3, minute: 0 }, dayShift: 1 });
  });
});

describe('expandGrid', () => {
  it('expands every 2 h from 09:00 until 21:00 into seven times, both ends included', () => {
    const times = expandGrid({ from: '09:00', until: '21:00', every: '02:00' });
    assert.deepEqual(times, [540, 660, 780, 900, 1020, 1140, 1260]);
  });

  it('refuses a grid that ends before it starts, or never moves', () => {
    assert.equal(expandGrid({ from: '21:00', until: '09:00', every: '02:00' }), null);
    assert.equal(expandGrid({ from: '09:00', until: '21:00', every: '00:00' }), null);
  });
});

describe('localDateToUtc', () => {
  it('reads a Yerevan afternoon as the instant four hours earlier in UTC', () => {
    assert.deepEqual(localDateToUtc('2026-11-20T15:00', YEREVAN), utc('Fri 2026-11-20 11:00'));
  });

  it('moves the date with the time across midnight', () => {
    assert.deepEqual(localDateToUtc('2026-11-20T01:30', YEREVAN), utc('Thu 2026-11-19 21:30'));
  });

  it('refuses a date that does not exist', () => {
    assert.equal(localDateToUtc('2026-02-30T10:00', YEREVAN), null);
    assert.equal(localDateToUtc('next friday', YEREVAN), null);
  });
});

describe('describeNow', () => {
  it('says the person\'s own date, clock and zone', () => {
    const text = describeNow(utc('Fri 2026-11-13 22:30'), YEREVAN);
    assert.equal(text, 'Now it is Saturday, 14 November 2026, 02:30 on the person\'s clock (UTC+04:00).');
  });
});
