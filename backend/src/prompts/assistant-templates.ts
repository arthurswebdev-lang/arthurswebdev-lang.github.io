import type { AnswerInput, TemplateSummary } from '../types/assistant.types.js';

/**
 * The common things people set up, and for each one: what to ask, and what to
 * fill in without asking. Rendered into the frozen system prompt (so they are
 * part of the cached prefix) and listed by `GET /assistant/templates` for the
 * quick-start chips. Adding a template is adding one object here.
 *
 * Times are the person's local clock. Window words: remind = when the push
 * comes, activeBefore = how early it shows as actual, activeFor = how long
 * after its time it stays actual. remind must not exceed activeBefore.
 */
export interface TemplateQuestion {
  field: string;
  question: string;
  input: AnswerInput;
  options?: string[];
  optional?: boolean;
}

export interface AssistantTemplate {
  id: string;
  title: string;
  creates: string;
  ask: TemplateQuestion[];
  defaults: string;
}

export const TEMPLATES: AssistantTemplate[] = [
  {
    id: 'course',
    title: '🎓 Pass a course',
    creates: 'BASIC, or EVENT when there is a deadline',
    ask: [
      { field: 'course', question: 'Which course?', input: 'text' },
      { field: 'link', question: 'Link to the course?', input: 'url', optional: true },
      { field: 'deadline', question: 'Is there a deadline? Pick the date, or skip.', input: 'date', optional: true },
      { field: 'lessons', question: 'Paste the list of lessons (or the course page) to use them as steps, or skip.', input: 'text', optional: true },
    ],
    defaults: 'Category EDUCATION. No deadline: BASIC. Deadline: EVENT at 20:00 that day, '
      + 'activeBefore = minutes from now until the deadline (actual the whole time, max 525600), '
      + 'remind 4320 (3 days before), activeFor 60. Lessons become steps, each with its link if known.',
  },
  {
    id: 'birthday',
    title: '🎂 Birthday',
    creates: 'REPEATED_MONTHLY with one month = once a year',
    ask: [
      { field: 'who', question: 'Whose birthday?', input: 'text' },
      { field: 'date', question: 'Which date? The year does not matter.', input: 'date' },
    ],
    defaults: 'dayOfMonth and months [month]. Time 10:00. activeBefore 1440 (seen the day before), '
      + 'remind 0, activeFor 1440 (the whole day). Category IMPORTANT. Name "🎂 <Who>\'s birthday". '
      + 'Offer once, optional: steps "Buy a gift", "Call". Same template for anniversaries and name days.',
  },
  {
    id: 'bills',
    title: '💡 Utility bills',
    creates: 'REPEATED_MONTHLY',
    ask: [
      { field: 'bills', question: 'Which bills do you pay?', input: 'list', options: ['Electricity', 'Water', 'Gas', 'Internet', 'Phone', 'Rent'] },
      { field: 'day', question: 'On which day of the month do you want to pay?', input: 'text' },
      { field: 'sameDay', question: 'The same day for all of them?', input: 'choice', options: ['Yes', 'No, different days'] },
      { field: 'time', question: 'At what time should I remind you?', input: 'time' },
      { field: 'payLinks', question: 'Do you have a link to pay <bill>? (one question per bill)', input: 'url', optional: true },
    ],
    defaults: 'Same day: ONE repeat "💡 Pay utilities" with one step per bill, each step with its '
      + 'payment link. Different days: one repeat per day, that day\'s bills as steps. months all 12. '
      + 'activeBefore 0, remind 0, activeFor 4320 (open 3 days, so paying late still counts). '
      + 'Category IMPORTANT. A day 29-31 does not exist in every month: suggest 28 or earlier.',
  },
  {
    id: 'gym',
    title: '🏋️ Weekly gym plan',
    creates: 'REPEATED_WEEKLY, one repeat per exercise',
    ask: [
      { field: 'path', question: 'Do you already have your exercises, or should I suggest a plan?', input: 'choice', options: ['I have my exercises', 'Suggest a plan'] },
      { field: 'days', question: 'Which days do you go to the gym?', input: 'list', options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
      { field: 'exercises', question: 'Path A: type or paste your exercises with weight and days, any format ("leg press 75 mon thu").', input: 'text' },
      { field: 'goal', question: 'Path B: your goal?', input: 'choice', options: ['Strength', 'Muscle', 'General fitness', 'Weight loss'] },
      { field: 'level', question: 'Path B: your level?', input: 'choice', options: ['Beginner', 'Some experience', 'Experienced'] },
      { field: 'avoid', question: 'Path B: any injuries or exercises to avoid?', input: 'text', optional: true },
      { field: 'photos', question: 'Do you want a picture for each exercise? Paste links, or skip.', input: 'text', optional: true },
    ],
    defaults: 'Copy this design exactly. Name "<Exercise> – <weight>kg", e.g. "Leg press – 75kg" '
      + '(weight unknown: "<Exercise> – ?kg"). One repeat per exercise, on the weekdays it is done. '
      + 'Steps: "Warm-up ×12 · lighter weight", "Set 1 ×12", "Set 2 ×12", "Set 3 ×12" (change the '
      + 'count if the person gives other sets/reps). Time 06:00. activeBefore 0, remind 0, '
      + 'activeFor 960 (open the whole gym day). Category GYM. Call find_repeats with category GYM '
      + 'first and do not duplicate an exercise that exists. Path B: propose a split for the chosen '
      + 'days (e.g. push / pull / legs), 4-6 exercises a day, then ask for each starting weight or '
      + 'let the person skip.',
  },
  {
    id: 'interview',
    title: '💼 Interview',
    creates: 'EVENT',
    ask: [
      { field: 'company', question: 'Which company and role?', input: 'text' },
      { field: 'when', question: 'When is it? Date first.', input: 'date' },
      { field: 'time', question: 'At what time?', input: 'time' },
      { field: 'where', question: 'Online or in person?', input: 'choice', options: ['Online', 'In person'] },
      { field: 'link', question: 'The meeting link (online) or a maps link (in person)?', input: 'url', optional: true },
      { field: 'prep', question: 'Do you want a preparation checklist?', input: 'choice', options: ['Yes', 'No'] },
    ],
    defaults: 'Category WORK. activeBefore 1440, remind 60, activeFor 90. Prep steps: "Read about '
      + 'the company", "Prepare questions to ask", "Review my CV", and "Test camera and mic" when '
      + 'online. Same template for doctor or dentist visits, meetings, exams, flights.',
  },
  {
    id: 'water',
    title: '💧 Drink water',
    creates: 'DAILY, several times a day',
    ask: [
      { field: 'from', question: 'From what time?', input: 'time' },
      { field: 'until', question: 'Until what time?', input: 'time' },
      { field: 'every', question: 'How often?', input: 'choice', options: ['Every 1 h', 'Every 1.5 h', 'Every 2 h', 'Every 3 h'] },
      { field: 'days', question: 'Every day, or only some days?', input: 'choice', options: ['Every day', 'Weekdays only'] },
    ],
    defaults: 'Use timeGrid, never compute the times yourself. activeBefore 0, remind 0, '
      + 'activeFor = the gap in minutes. Category SELFCARE. Name "💧 Drink water".',
  },
  {
    id: 'medicine',
    title: '💊 Medicine / supplements',
    creates: 'DAILY',
    ask: [
      { field: 'pills', question: 'Which pills or supplements?', input: 'text' },
      { field: 'times', question: 'At what times of day? Tell me which pill goes when.', input: 'text' },
    ],
    defaults: 'One repeat per time of day, its pills as steps (one push, not one per pill). '
      + 'activeBefore 0, remind 0, activeFor 120. Category SUPPLEMENTS. Repeats have no end date: '
      + 'for a course of N days, say so and suggest pausing it when done.',
  },
  {
    id: 'routine',
    title: '🧘 Morning / evening routine',
    creates: 'DAILY',
    ask: [
      { field: 'time', question: 'At what time?', input: 'time' },
      { field: 'steps', question: 'What are the steps?', input: 'text' },
    ],
    defaults: 'One repeat with the routine as steps. activeBefore 0, remind 0, activeFor 90. '
      + 'Category SELFCARE.',
  },
  {
    id: 'weekly-call',
    title: '📞 Weekly call or lesson',
    creates: 'REPEATED_WEEKLY',
    ask: [
      { field: 'what', question: 'What is it?', input: 'text' },
      { field: 'days', question: 'On which days?', input: 'list', options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
      { field: 'time', question: 'At what time?', input: 'time' },
      { field: 'link', question: 'The meeting link?', input: 'url', optional: true },
    ],
    defaults: 'activeBefore 30, remind 10, activeFor 60. Link on the task. Category WORK or '
      + 'EDUCATION, whichever fits.',
  },
  {
    id: 'renewal',
    title: '📄 Yearly renewal',
    creates: 'REPEATED_MONTHLY with one month',
    ask: [
      { field: 'what', question: 'What needs renewing (insurance, passport, domain…)?', input: 'text' },
      { field: 'date', question: 'On which date?', input: 'date' },
      { field: 'link', question: 'A link to renew it?', input: 'url', optional: true },
    ],
    defaults: 'Time 10:00. activeBefore 20160 (2 weeks before), remind 10080 (1 week before), '
      + 'activeFor 1440. Category IMPORTANT.',
  },
  {
    id: 'subscription',
    title: '💳 Subscription payment',
    creates: 'REPEATED_MONTHLY',
    ask: [
      { field: 'what', question: 'Which subscription?', input: 'text' },
      { field: 'day', question: 'On which day of the month is it charged?', input: 'text' },
      { field: 'link', question: 'A link to manage it?', input: 'url', optional: true },
    ],
    defaults: 'Time 10:00, months all 12. activeBefore 1440, remind 1440, activeFor 1440. '
      + 'Category IMPORTANT. One repeat per subscription.',
  },
  {
    id: 'list',
    title: '🛒 Shopping or packing list',
    creates: 'BASIC',
    ask: [
      { field: 'items', question: 'Type or paste the items.', input: 'text' },
    ],
    defaults: 'Each item becomes a step. Category FOOD for shopping, OTHER for packing.',
  },
  {
    id: 'trip',
    title: '✈️ Trip',
    creates: 'EVENT',
    ask: [
      { field: 'where', question: 'Where are you going?', input: 'text' },
      { field: 'date', question: 'Departure date?', input: 'date' },
      { field: 'time', question: 'Departure time?', input: 'time' },
      { field: 'links', question: 'Ticket or booking links?', input: 'url', optional: true },
      { field: 'packing', question: 'Do you want a packing list as steps?', input: 'choice', options: ['Yes', 'No'] },
    ],
    defaults: 'activeBefore 4320 (3 days before), remind 1440, activeFor 120. Category OTHER.',
  },
  {
    id: 'habit',
    title: '📖 Reading or language habit',
    creates: 'DAILY',
    ask: [
      { field: 'what', question: 'What do you want to practise (a book, a language app…)?', input: 'text' },
      { field: 'minutes', question: 'How many minutes a day?', input: 'choice', options: ['10', '20', '30', '60'] },
      { field: 'time', question: 'At what time?', input: 'time' },
    ],
    defaults: 'Name includes the target, e.g. "📖 Read 20 min". activeBefore 0, remind 0, '
      + 'activeFor 180. Category READING or EDUCATION.',
  },
  {
    id: 'chores',
    title: '🧹 House chores',
    creates: 'REPEATED_WEEKLY',
    ask: [
      { field: 'chores', question: 'Which chores, and on which day each?', input: 'text' },
      { field: 'time', question: 'At what time should I remind you?', input: 'time' },
    ],
    defaults: 'One repeat per day with that day\'s chores as steps. activeBefore 0, remind 0, '
      + 'activeFor 720. Category OTHER.',
  },
];

export const templateById = (id: string): AssistantTemplate | undefined =>
  TEMPLATES.find((template) => template.id === id);

export const templateSummaries = (): TemplateSummary[] =>
  TEMPLATES.map(({ id, title }) => ({ id, title }));

function questionLine(question: TemplateQuestion): string {
  const options = question.options === undefined ? '' : ` [${question.options.join(' | ')}]`;
  const optional = question.optional === true ? ' (optional — offer once, allow skip)' : '';

  return `  - ${question.field} (${question.input})${options}: ${question.question}${optional}`;
}

/** The templates as prompt text. Pure and stable: same bytes on every call. */
export function renderTemplates(): string {
  return TEMPLATES.map((template) => [
    `### ${template.id} — ${template.title} → ${template.creates}`,
    'Ask, in order:',
    ...template.ask.map(questionLine),
    `Fill in yourself: ${template.defaults}`,
  ].join('\n')).join('\n\n');
}
