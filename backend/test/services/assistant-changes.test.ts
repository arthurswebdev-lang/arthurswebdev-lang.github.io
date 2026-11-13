import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskCategory } from '../../src/enum/task-category.enum.js';
import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import type { AssistantModelReply } from '../../src/interfaces/assistant-client.interface.js';
import { AssistantToolsService } from '../../src/services/assistant-tools.service.js';
import { AssistantService } from '../../src/services/assistant.service.js';
import { RepeatedTasksService } from '../../src/services/repeated-tasks.service.js';
import { TaskGeneratorService } from '../../src/services/task-generator.service.js';
import { TasksService } from '../../src/services/tasks.service.js';
import type { IRepeatedTasksService } from '../../src/interfaces/repeated-tasks-service.interface.js';
import type { ITasksService } from '../../src/interfaces/tasks-service.interface.js';
import { AssistantChangesService } from '../../src/services/assistant-changes.service.js';
import type { AssistantSession } from '../../src/types/assistant.types.js';
import type { CreateWeeklyTask } from '../../src/types/repeated-tasks.types.js';
import type { Task, UpdateTask } from '../../src/types/tasks.types.js';
import { buildPayload } from '../../src/utils/plan-payload.util.js';
import { configToDraft } from '../../src/utils/plan-draft.util.js';
import { InMemoryRepeatedTasksRepository } from '../support/in-memory-repeated-repository.js';
import { InMemoryTasksRepository } from '../support/in-memory-repository.js';
import {
  CountingUsage, InMemoryAssistantSessions, ScriptedClient, reply, text, toolUse,
} from '../support/in-memory-assistant.js';
import { TEST_USER_ID, aBasicTask } from '../support/tasks.js';
import { utc } from '../support/time.js';

const YEREVAN = -240;
const NOW = utc('Fri 2026-11-13 10:00');
const offset = { timezoneOffsetMinutes: YEREVAN };

const legPress: CreateWeeklyTask = {
  type: TaskType.REPEATED_WEEKLY,
  name: 'Leg press – 75kg',
  category: TaskCategory.GYM,
  weekdays: [1, 4],
  timesOfDay: [{ hour: 2, minute: 0 }],
  subtasks: [{ name: 'Set 1 ×12' }, { name: 'Set 2 ×12' }],
  remindBeforeMins: 0,
  activeBeforeMins: 0,
  activeForMins: 960,
};

function setup(script: AssistantModelReply[]) {
  const tasks = new InMemoryTasksRepository([]);
  const configs = new InMemoryRepeatedTasksRepository([]);
  const generator = new TaskGeneratorService(tasks, configs);
  const tasksService = new TasksService(tasks, configs, generator, () => NOW);
  const repeats = new RepeatedTasksService(configs, tasks, generator);
  const client = new ScriptedClient(script);
  const service = new AssistantService(
    new InMemoryAssistantSessions(), new CountingUsage(), client,
    new AssistantToolsService(tasksService, repeats), () => NOW,
  );

  return { service, client, tasksService, repeats };
}

const change = (id: string, fields: object) => toolUse('plan-1', 'propose_plan', {
  changes: [{ target: 'repeat', id, ...fields }], assumptions: [],
});

describe('assistant changes — a repeat', () => {
  it('renames and pauses a repeat after Accept, showing before → after first', async () => {
    const { service, repeats, client } = setup([]);
    const config = await repeats.create(legPress, TEST_USER_ID);
    client.replies.push(
      reply(change(config.id, { name: 'Leg press – 80kg', enabled: false })),
      reply(toolUse('update-1', 'update_repeated_task', { planItem: 1 })),
      reply(text('Done.')),
    );

    const shown = await service.start(TEST_USER_ID, { message: 'leg press is 80 now, and pause it', ...offset });
    assert.match(shown.plan ?? '', /Name: Leg press – 75kg → Leg press – 80kg\n {3}⏸ Pause it/);

    const done = await service.accept(TEST_USER_ID, shown.sessionId, offset);
    const stored = await repeats.getById(config.id, TEST_USER_ID);
    assert.equal(done.done, true);
    assert.equal(done.created?.[0]?.action, 'updated');
    assert.deepEqual([stored?.name, stored?.enabled], ['Leg press – 80kg', false]);
  });

});

describe('assistant changes — guard', () => {
  it('refuses an update call before Accept', async () => {
    const { service, repeats, client } = setup([]);
    const config = await repeats.create(legPress, TEST_USER_ID);
    client.replies.push(reply(toolUse('u', 'update_repeated_task', { planItem: 1 })), reply(text('Tap Accept.')));

    await service.start(TEST_USER_ID, { message: 'pause it', ...offset });
    assert.match(JSON.stringify(client.seen[1]?.at(-1)), /Not accepted yet/);
    assert.equal((await repeats.getById(config.id, TEST_USER_ID))?.enabled, true);
  });
});

describe('assistant changes — tasks', () => {
  it('refuses to edit a task made by a repeat, and points at the repeat', async () => {
    const { service, repeats, tasksService, client } = setup([]);
    const config = await repeats.create(legPress, TEST_USER_ID);
    const [occurrence] = await tasksService.listAll({ userId: TEST_USER_ID });
    assert.ok(occurrence !== undefined);
    client.replies.push(
      reply(toolUse('p', 'propose_plan', { changes: [{ target: 'task', id: occurrence.id, name: 'x' }], assumptions: [] })),
      reply(text('I will change the repeat instead.')),
    );

    await service.start(TEST_USER_ID, { message: 'rename today\'s leg press', ...offset });
    assert.match(JSON.stringify(client.seen[1]?.at(-1)), new RegExp(`made by a repeat \\(id \\\\"${config.id}`));
  });

});

describe('assistant changes — status', () => {
  it('marks a task made by a repeat as done — the one edit it accepts', async () => {
    const { service, repeats, tasksService, client } = setup([]);
    await repeats.create(legPress, TEST_USER_ID);
    const [occurrence] = await tasksService.listAll({ userId: TEST_USER_ID });
    assert.ok(occurrence !== undefined);
    client.replies.push(
      reply(toolUse('p', 'propose_plan', { changes: [{ target: 'task', id: occurrence.id, status: 'DONE' }], assumptions: [] })),
      reply(toolUse('u', 'update_task', { planItem: 1 })),
      reply(text('Done.')),
    );

    const shown = await service.start(TEST_USER_ID, { message: 'I did leg press', ...offset });
    assert.match(shown.plan ?? '', /Mark as done/);
    await service.accept(TEST_USER_ID, shown.sessionId, offset);
    assert.equal((await tasksService.getById(occurrence.id, TEST_USER_ID))?.status, TaskStatus.DONE);
  });

});

describe('assistant changes — ticks', () => {
  it('keeps the ticks of steps it does not rename on a hand-made task', async () => {
    const task: Task = {
      ...aBasicTask('Shopping'),
      subtasks: [
        { id: 'a', name: 'Milk', status: TaskStatus.DONE },
        { id: 'b', name: 'Bread', status: TaskStatus.TODO },
      ],
    };
    const tasksService = { getById: async () => Promise.resolve(task) } as unknown as ITasksService;
    const changes = new AssistantChangesService(tasksService, {} as IRepeatedTasksService);
    const session = { userId: TEST_USER_ID, offsetMinutes: YEREVAN } as AssistantSession;

    const prepared = await changes.prepare({
      target: 'task', id: task.id, steps: [{ name: 'Milk' }, { name: 'Bread' }, { name: 'Eggs' }],
    }, 1, session);
    assert.ok(typeof prepared !== 'string');
    const steps = ((prepared.payload as UpdateTask).subtasks ?? [])
      .map((step) => `${step.name}:${String(step.status)}`);
    assert.deepEqual(steps, ['Milk:DONE', 'Bread:TODO', 'Eggs:TODO']);
  });
});

describe('configToDraft', () => {
  it('reads a stored repeat back on the person\'s clock, so an unchanged edit stores the same thing', async () => {
    const { repeats } = setup([]);
    // 01:00 Mon/Thu in Yerevan is 21:00 Sun/Wed in UTC: the day-shift case.
    const config = await repeats.create({ ...legPress, weekdays: [0, 3], timesOfDay: [{ hour: 21, minute: 0 }] }, TEST_USER_ID);
    const draft = configToDraft(config, YEREVAN);

    assert.deepEqual([draft.times, draft.weekdays], [['01:00'], [1, 4]]);
    const payload = buildPayload(draft, YEREVAN);
    assert.deepEqual('weekdays' in payload ? [payload.timesOfDay, payload.weekdays] : null, [[{ hour: 21, minute: 0 }], [0, 3]]);
  });
});
