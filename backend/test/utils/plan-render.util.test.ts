import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskCategory } from '../../src/enum/task-category.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import type { PlanDraft, PlanItem } from '../../src/types/assistant.types.js';
import { buildPayload } from '../../src/utils/plan-payload.util.js';
import { formatDuration, renderPlan } from '../../src/utils/plan-render.util.js';

const YEREVAN = -240;

const itemsOf = (drafts: PlanDraft[]): PlanItem[] => drafts.map((draft, index) => ({
  number: index + 1, draft, payload: buildPayload(draft, YEREVAN),
}));

const BILLS_PLAN = [
  '📋 Plan — 1 repeat',
  '',
  '1. 🔁 💡 Pay utilities',
  '   Every month on the 10th, 19:00',
  '   Steps: Electricity 🔗 · Water',
  '   Push on time · stays open 3 days · Important',
  '',
  'I decided myself:',
  '• Important, because a late bill costs money',
].join('\n');

describe('renderPlan', () => {
  it('shows bills as one repeat with a step per bill', () => {
    const text = renderPlan(itemsOf([{
      kind: TaskType.REPEATED_MONTHLY,
      name: '💡 Pay utilities',
      category: TaskCategory.IMPORTANT,
      dayOfMonth: 10,
      months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      times: ['19:00'],
      steps: [{ name: 'Electricity', link: 'https://ena.am/pay' }, { name: 'Water' }],
      activeBeforeMins: 0,
      activeForMins: 4320,
    }]), ['Important, because a late bill costs money']);

    assert.equal(text, BILLS_PLAN);
  });

});

describe('renderPlan — schedules in words', () => {
  it('says a one-month repeat happens once a year', () => {
    const text = renderPlan(itemsOf([{
      kind: TaskType.REPEATED_MONTHLY, name: '🎂 Mother\'s birthday', dayOfMonth: 4, months: [8], times: ['10:00'],
    }]), []);
    assert.match(text, /Every year on 4 August, 10:00/);
  });

  it('shortens a long list of times', () => {
    const text = renderPlan(itemsOf([{
      kind: TaskType.REPEATED_DAILY,
      name: '💧 Drink water',
      timeGrid: { from: '09:00', until: '21:00', every: '02:00' },
      activeBeforeMins: 0,
      activeForMins: 120,
    }]), []);
    assert.match(text, /Every day at 09:00, 11:00 … 21:00 \(7 times\)/);
  });

});

describe('renderPlan — grouping', () => {
  it('groups three or more like gym exercises into one block by weekday', () => {
    const exercise = (name: string, weekdays: number[]): PlanDraft => ({
      kind: TaskType.REPEATED_WEEKLY, name, weekdays, times: ['06:00'], category: TaskCategory.GYM,
      steps: [{ name: 'Set 1 ×12' }], activeBeforeMins: 0, activeForMins: 960,
    });
    const text = renderPlan(itemsOf([
      exercise('Leg press – 75kg', [1, 4]),
      exercise('Triceps – 40kg', [2, 4]),
      exercise('Low row – 50kg', [3]),
    ]), []);

    assert.match(text, /🔁 3 weekly repeats \(items 1, 2, 3\)/);
    assert.match(text, /All: 06:00 · Steps: Set 1 ×12 · Push on time · stays open 16 h · Gym/);
    assert.match(text, /Thu {2}Leg press – 75kg · Triceps – 40kg/);
  });
});

describe('formatDuration', () => {
  it('uses the largest whole unit', () => {
    assert.equal(formatDuration(1440), '1 day');
    assert.equal(formatDuration(4320), '3 days');
    assert.equal(formatDuration(120), '2 h');
    assert.equal(formatDuration(90), '90 min');
  });
});
