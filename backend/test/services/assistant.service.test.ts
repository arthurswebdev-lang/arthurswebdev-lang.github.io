import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskCategory } from '../../src/enum/task-category.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import type { AssistantModelReply } from '../../src/interfaces/assistant-client.interface.js';
import { AssistantToolsService } from '../../src/services/assistant-tools.service.js';
import { AssistantService, MAX_SESSION_MESSAGES } from '../../src/services/assistant.service.js';
import { RepeatedTasksService } from '../../src/services/repeated-tasks.service.js';
import { TaskGeneratorService } from '../../src/services/task-generator.service.js';
import { TasksService } from '../../src/services/tasks.service.js';
import type { PlanDraft } from '../../src/types/assistant.types.js';
import { ConflictError } from '../../src/utils/http-errors/conflict.error.js';
import { TooManyRequestsError } from '../../src/utils/http-errors/too-many-requests.error.js';
import { InMemoryRepeatedTasksRepository } from '../support/in-memory-repeated-repository.js';
import { InMemoryTasksRepository } from '../support/in-memory-repository.js';
import {
  CountingUsage, InMemoryAssistantSessions, ScriptedClient, reply, text, toolUse,
} from '../support/in-memory-assistant.js';
import { TEST_USER_ID } from '../support/tasks.js';
import { utc } from '../support/time.js';

const YEREVAN = -240;
const NOW = utc('Fri 2026-11-13 10:00');

const bills: PlanDraft = {
  kind: TaskType.REPEATED_MONTHLY,
  name: '💡 Pay utilities',
  category: TaskCategory.IMPORTANT,
  dayOfMonth: 10,
  months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  times: ['19:00'],
  steps: [{ name: 'Electricity' }, { name: 'Water' }],
  activeBeforeMins: 0,
  activeForMins: 4320,
};

const propose = (id: string, items: PlanDraft[]) =>
  toolUse(id, 'propose_plan', { items, assumptions: [] });

function setup(script: AssistantModelReply[]) {
  const tasks = new InMemoryTasksRepository([]);
  const configs = new InMemoryRepeatedTasksRepository([]);
  const generator = new TaskGeneratorService(tasks, configs);
  const tools = new AssistantToolsService(
    new TasksService(tasks, configs, generator, () => NOW),
    new RepeatedTasksService(configs, tasks, generator),
  );
  const sessions = new InMemoryAssistantSessions();
  const usage = new CountingUsage();
  const client = new ScriptedClient(script);
  const service = new AssistantService(sessions, usage, client, tools, () => NOW);

  return { service, sessions, usage, client, configs };
}

const offset = { timezoneOffsetMinutes: YEREVAN };

describe('AssistantService — asking', () => {
  it('shows one question, then hands the answer back as that tool\'s result', async () => {
    const { service, client, sessions } = setup([
      reply(toolUse('ask-1', 'ask_user', { field: 'day', question: 'Which day?', input: 'text' })),
      reply(text('Thanks.')),
    ]);

    const first = await service.start(TEST_USER_ID, { templateId: 'bills', ...offset });
    assert.deepEqual(first.ask, { field: 'day', question: 'Which day?', input: 'text' });

    await service.send(TEST_USER_ID, first.sessionId, { message: '10', ...offset });
    const lastTurn = client.seen[1]?.at(-1);
    assert.deepEqual(lastTurn, {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'ask-1', content: 'The person answered: 10' }],
    });
    assert.deepEqual(sessions.sessions.get(first.sessionId)?.answers, { day: '10' });
  });

  it('starts with the person\'s own date and clock, never in the system prompt', async () => {
    const { service, client } = setup([reply(text('Hi.'))]);
    await service.start(TEST_USER_ID, { message: 'water reminders', ...offset });

    assert.match(JSON.stringify(client.seen[0]?.[0]), /Friday, 13 November 2026, 14:00/);
  });
});

describe('AssistantService — plan, Accept, create', () => {
  it('shows the plan, creates only after Accept, and then deletes the session', async () => {
    const { service, sessions, configs } = setup([
      reply(propose('plan-1', [bills])),
      reply(toolUse('create-1', 'create_repeated_task', { planItem: 1, item: bills })),
      reply(text('Saved.')),
    ]);

    const shown = await service.start(TEST_USER_ID, { message: 'bills on the 10th', ...offset });
    assert.match(shown.plan ?? '', /1\. 🔁 💡 Pay utilities/);
    assert.equal((await configs.list(TEST_USER_ID)).length, 0);

    const done = await service.accept(TEST_USER_ID, shown.sessionId, offset);
    assert.equal(done.done, true);
    assert.equal(done.created?.[0]?.name, '💡 Pay utilities');
    assert.equal((await configs.list(TEST_USER_ID)).length, 1);
    assert.equal(sessions.sessions.size, 0);
  });

});

describe('AssistantService — what the create tools refuse', () => {
  it('refuses a create call before Accept, and saves nothing', async () => {
    const { service, client, configs } = setup([
      reply(toolUse('create-1', 'create_repeated_task', { planItem: 1, item: bills })),
      reply(text('Please tap Accept first.')),
    ]);
    const answer = await service.start(TEST_USER_ID, { message: 'bills', ...offset });

    assert.equal(answer.created, undefined);
    assert.match(JSON.stringify(client.seen[1]?.at(-1)), /Not accepted yet/);
    assert.equal((await configs.list(TEST_USER_ID)).length, 0);
  });

  it('refuses a create call whose item differs from the accepted plan', async () => {
    const { service, client, configs } = setup([
      reply(propose('plan-1', [bills])),
      reply(toolUse('create-1', 'create_repeated_task', { planItem: 1, item: { ...bills, dayOfMonth: 12 } })),
      reply(text('Sorry.')),
    ]);
    const shown = await service.start(TEST_USER_ID, { message: 'bills', ...offset });
    const after = await service.accept(TEST_USER_ID, shown.sessionId, offset);

    assert.equal(after.done, false);
    assert.match(JSON.stringify(client.seen[2]?.at(-1)), /does not match accepted plan item 1/);
    assert.equal((await configs.list(TEST_USER_ID)).length, 0);
  });

});

describe('AssistantService — changing and fixing a plan', () => {
  it('typing a change makes the shown plan impossible to accept', async () => {
    const { service } = setup([reply(propose('plan-1', [bills])), reply(text('What day then?'))]);
    const shown = await service.start(TEST_USER_ID, { message: 'bills', ...offset });
    await service.send(TEST_USER_ID, shown.sessionId, { message: 'make it the 12th', ...offset });

    await assert.rejects(service.accept(TEST_USER_ID, shown.sessionId, offset), ConflictError);
  });

  it('sends a refused plan back to the model as an error it can fix', async () => {
    const broken: PlanDraft = { ...bills, remindBeforeMins: 60, activeBeforeMins: 0 };
    const { service, client } = setup([reply(propose('plan-1', [broken])), reply(propose('plan-2', [bills]))]);
    const shown = await service.start(TEST_USER_ID, { message: 'bills', ...offset });

    assert.match(JSON.stringify(client.seen[1]?.at(-1)), /"is_error":true/);
    assert.match(shown.plan ?? '', /Pay utilities/);
  });
});

describe('AssistantService — keeping history small', () => {
  it('restarts a long chat from a summary built from the stored answers', async () => {
    const { service, sessions, client } = setup([reply(text('a')), reply(text('b'))]);
    const first = await service.start(TEST_USER_ID, { templateId: 'bills', ...offset });
    const stored = sessions.sessions.get(first.sessionId);
    assert.ok(stored !== undefined);
    stored.answers = { bills: 'Electricity, Water', day: '10' };
    stored.messages = Array.from({ length: MAX_SESSION_MESSAGES }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const, content: 'x',
    }));

    await service.send(TEST_USER_ID, first.sessionId, { message: '19:00', ...offset });
    const sent = client.seen[1] ?? [];
    assert.equal(sent.length, 1);
    assert.match(JSON.stringify(sent[0]), /Answers: bills = Electricity, Water; day = 10/);
  });

});

describe('AssistantService — limits and privacy', () => {
  it('stops at the daily limit', async () => {
    const { service, usage } = setup([]);
    usage.count = 100;

    await assert.rejects(service.start(TEST_USER_ID, { message: 'hi', ...offset }), TooManyRequestsError);
  });

  it('never shows one person\'s session to another', async () => {
    const { service } = setup([reply(text('Hi.'))]);
    const first = await service.start(TEST_USER_ID, { message: 'hi', ...offset });

    await assert.rejects(service.send('someone-else', first.sessionId, { message: 'x', ...offset }), /ended/);
  });
});

describe('AssistantService — odd tool input', () => {
  it('turns a malformed plan item into a tool error, not a 500', async () => {
    const { service, client } = setup([
      reply(toolUse('plan-1', 'propose_plan', { items: [{ kind: TaskType.BASIC, name: 'x', steps: 'not a list' }] })),
      reply(text('Let me fix that.')),
    ]);
    const answer = await service.start(TEST_USER_ID, { message: 'shopping', ...offset });

    assert.equal(answer.text, 'Let me fix that.');
    assert.match(JSON.stringify(client.seen[1]?.at(-1)), /"is_error":true/);
  });
});
