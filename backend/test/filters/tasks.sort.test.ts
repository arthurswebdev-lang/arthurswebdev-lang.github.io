import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { sortTasks } from '../../src/filters/tasks.sort.js';
import type { Task } from '../../src/types/tasks.types.js';
import { aBasicTask, anEvent } from '../support/tasks.js';

const at = (name: string, time: string): Task => anEvent(name, `2026-08-19 ${time}`);

const done = (task: Task): Task => ({ ...task, status: TaskStatus.DONE });

const namesOf = (tasks: Task[]): string[] => tasks.map((task) => task.name);

describe('list order', () => {
  it('puts the earliest event first and dateless tasks after every dated one', () => {
    const sorted = sortTasks([aBasicTask('1'), at('late', '14:39'), at('early', '12:00')]);

    assert.deepEqual(namesOf(sorted), ['early', 'late', '1']);
  });

  it('drops finished tasks to the end whatever their date', () => {
    const sorted = sortTasks([done(at('finished', '08:00')), at('open', '23:00')]);

    assert.deepEqual(namesOf(sorted), ['open', 'finished']);
  });

});

describe('list order, a whole day', () => {
  it('reads events by time, then the dateless ones, then everything finished', () => {
    const shuffled = [
      done(at('done-c', '07:00')), aBasicTask('3'), at('event 14:39', '14:39'),
      done(aBasicTask('done-a')), aBasicTask('1'), at('event 12:00', '12:00'),
      aBasicTask('2'), done(at('done-b', '09:00')),
    ];

    assert.deepEqual(namesOf(sortTasks(shuffled)), [
      'event 12:00', 'event 14:39', '1', '2', '3', 'done-c', 'done-b', 'done-a',
    ]);
  });

  it('breaks ties by id so the same list never shuffles between calls', () => {
    const first = sortTasks([aBasicTask('b'), aBasicTask('a')]);
    const again = sortTasks([aBasicTask('a'), aBasicTask('b')]);

    assert.deepEqual(namesOf(first), namesOf(again));
  });

  it('leaves the caller its own array', () => {
    const given = [aBasicTask('1'), at('early', '12:00')];
    sortTasks(given);

    assert.deepEqual(namesOf(given), ['1', 'early']);
  });
});
