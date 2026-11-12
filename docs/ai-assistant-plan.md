# AI assistant: the fourth way to create a task

Today the composer offers three ways to create something: **One-time task**, **Event** and
**Repeating task**. This plan adds a fourth: **✨ Ask AI**. You chat with an agent, it asks
what it needs one question at a time, fills the rest with sensible defaults, shows you what it
is going to create, and creates it when you say yes.

This plan builds on `docs/chat-assistant-feature.md` (the earlier design note). That note is
still right about the Claude API details: tool use, prompt caching, local→UTC conversion, the
`IAssistantClient` seam for tests and the cost numbers. This plan changes four things in it:

| Earlier note | This plan | Why |
| --- | --- | --- |
| One sentence in, task created at once | **A guided chat**: questions one by one, then a proposal | Bills, gym plans and medicine need several answers. Guessing them is worse than asking. |
| The model calls `create_*` and the task is written | The model **proposes**; a **Create** button writes it | The model never writes to the database. A gym plan is 14 repeats — one wrong guess should not land 14 times. |
| One running conversation per user | **Short sessions**, deleted when they end | Chat history must not grow. Nothing about a chat outlives it. |
| Free-form | **Templates** for the common cases | The agent knows what to ask for a birthday, what to ask for bills, and what it can fill in by itself. |

Everything is relative to `backend/` unless it says `frontend/`.

---

## 1. Framework choice

**No LangChain, LangGraph or Mastra. The official `@anthropic-ai/sdk` and our own small loop.**

The "graph" in this feature is tiny: *ask → ask → propose → confirm*. The state that matters
(which template, what was answered, what is proposed) is ours and lives in Mongo. A framework
would hide the prompt and the tool loop, which are exactly the two things we need to see and
test. The loop is about 20 lines (written as recursion, because of `no-await-in-loop`).

If one day the assistant needs long multi-step workflows with pause and resume, Mastra is the
one to look at. Not now.

---

## 2. Templates

A **template** is a known use case. It says:

- **type** — what it creates (`BASIC`, `EVENT`, `DAILY`, `REPEATED_WEEKLY`, `REPEATED_MONTHLY`);
- **ask** — the questions the agent must ask, in order, and what kind of answer each one is
  (text, time, date, link, choice);
- **auto** — what the agent fills by itself and does not ask about (category, window, default
  time, standard steps). It still *shows* these in the proposal, so you can change them;
- **optional** — what it offers once ("Do you want to add a link?") but does not insist on.

The agent is not limited to templates. If nothing fits, it falls back to the general rules
(the type table in section 13 of the earlier note). Templates exist so the common cases are
fast and the same every time.

All times below are **your local time**. The server converts to UTC (earlier note, section 7).

**Window words, used in every template** (all in minutes, from the task's own time):

- `remindBeforeMins` — when the push notification comes;
- `activeBeforeMins` — how early the task moves from *Upcoming* to *Actual*;
- `activeForMins` — how long after its time it stays *Actual* before it becomes *Passed*.

Rule from the app: `remindBeforeMins` must not be bigger than `activeBeforeMins`.

### 2.1 Pass a course — `BASIC` (or `EVENT` if there is a deadline)

| | |
| --- | --- |
| Ask | 1. Course name. 2. Link to the course. 3. "Is there a deadline?" — yes → date. 4. "Do you want the lessons as steps? Paste the list of lessons or the course page." |
| Auto | Category `EDUCATION`. No deadline → `BASIC` (always actual). Deadline → `EVENT` at 20:00 on that day, `activeBeforeMins` = from now until the deadline (it is actual the whole time), `remindBeforeMins` = 3 days, `activeForMins` = 60. |
| Optional | A link on each lesson step (a step carries one link). |
| Example | *"Kubernetes for developers"*, 12 steps, one per lesson, link to the course. |

### 2.2 Birthday — `REPEATED_MONTHLY` with one month (= once a year)

| | |
| --- | --- |
| Ask | 1. Whose birthday? 2. Date (day + month, year not needed). |
| Auto | `fromDay` = day, `months` = [month]. Time 10:00. `activeBeforeMins` 1440 (you see it the day before), `remindBeforeMins` 0 (push on the day at 10:00), `activeForMins` 1440 (actual the whole day). Category `IMPORTANT`. Name: "🎂 Mother's birthday". |
| Optional | Steps: "Buy a gift", "Call". |
| Same template for | Anniversary, name day, memorial days. |

There is no yearly type and it is not needed: a monthly rule with one month fires once a year.

### 2.3 Utility bills (electricity, water, gas, internet…) — `REPEATED_MONTHLY`

| | |
| --- | --- |
| Ask | 1. Which bills? (choices: Electricity, Water, Gas, Internet, Phone, Rent, + other). 2. Which day of the month do you want to pay? 3. "Same day for all of them?" 4. At what time do you want the reminder? 5. For each bill: "Do you have a link to pay it?" (can skip). |
| Auto | **Same day for all → one repeat "💡 Pay utilities" with one step per bill**, each step carrying its payment link. Different days → one repeat per day, with the bills of that day as steps. `months` = all 12. `activeBeforeMins` 0, `remindBeforeMins` 0, `activeForMins` 4320 (stays actual for 3 days, so you can pay late). Category `IMPORTANT`. |
| Why steps | One reminder, one checklist. Ticking every bill finishes the task; finishing the task ticks every bill (existing behaviour). |
| Watch out | `fromDay` 29–31 does not exist in every month. The agent suggests day 28 or earlier (open question in section 9). |

### 2.4 Weekly gym plan — `REPEATED_WEEKLY`, **one repeat per exercise**

This copies the design already used by the `gym` account (14 repeats, read from the database):

| Field | Value in the existing plan |
| --- | --- |
| Name | `"<Exercise> – <weight>"`, e.g. `"Leg press – 75kg"`, `"Chest barbells 45° incline – 22.5kg"` |
| One repeat per | exercise, on the weekdays it is done (e.g. Leg press Mon + Thu) |
| Steps | `Warm-up ×12 · lighter weight`, `Set 1 ×12`, `Set 2 ×12`, `Set 3 ×12` |
| Time | 06:00 Yerevan (02:00 UTC) — the default time |
| Window | `activeBeforeMins` 0, `remindBeforeMins` 0, `activeForMins` 960 (actual for 16 hours, the whole gym day) |
| Category | `GYM` |

The weight is in the **name**, because the name is what you read in the gym. Changing the
weight later is a rename, and rewriting a running session is already supported
(`refreshEventsOfConfig` keeps the ticks).

Two ways in — the agent asks first: *"Do you already have exercises, or should I suggest a plan?"*

**A. "I have my exercises."**

| | |
| --- | --- |
| Ask | 1. Which days do you go? 2. Paste or type your exercises with weight and days, any format ("leg press 75 mon thu"). 3. Sets and reps, if not 3×12. 4. "Do you want a picture for each exercise?" (photo link, optional). |
| Auto | Everything in the table above. Before proposing, the agent calls `find_repeats` (category GYM) so it does not create an exercise you already have. |

**B. "Suggest a plan."**

| | |
| --- | --- |
| Ask | 1. Goal (strength / muscle / general fitness / weight loss). 2. Days per week (2–6) and which days. 3. Level (beginner / some experience / experienced). 4. Gym or home (what equipment). 5. "Any injuries or exercises to avoid?" |
| Auto | The agent proposes a split (e.g. 3 days: push / pull / legs), 4–6 exercises per day, **starting weights left as "?"** — it cannot know them. It then asks for the weight of each, or you can skip and edit later. |
| Then | Same shape as path A. The proposal is a list; you can say "remove triceps", "move legs to Friday" before pressing Create. |

The agent must not read another account's data. "The gym design" is written into the template
as rules (the table above), not loaded from the `gym` user.

### 2.5 Interview — `EVENT`

| | |
| --- | --- |
| Ask | 1. Company and role. 2. Date and time. 3. Online or in person? → meeting link, or address (as a maps link). 4. "Do you want a preparation checklist?" |
| Auto | Category `WORK`. `activeBeforeMins` 1440 (visible from the day before), `remindBeforeMins` 60 (push 1 hour before), `activeForMins` 90. Suggested steps if yes: "Read about the company", "Prepare questions to ask", "Review my CV", "Test camera and mic" (online only). |
| Same template for | Doctor or dentist visit, meeting, exam, flight. Only the category and the suggested steps change. |

### 2.6 Drink water — `DAILY`, several times a day

| | |
| --- | --- |
| Ask | 1. From what time? (time) 2. Until what time? (time) 3. How often? (choices: every 1h / 1.5h / 2h / 3h) — **or** "how many glasses a day?" and the agent spreads them evenly. 4. Every day, or only some days? |
| Auto | Times are a grid: 09:00–21:00 every 2h → 09, 11, 13, 15, 17, 19, 21. **The server expands the grid, not the model** (port of `expandWindow` from `frontend/app.js`). `activeBeforeMins` 0, `remindBeforeMins` 0, `activeForMins` = the gap (120), so one glass is "actual" until the next. Category `SELFCARE`. Name "💧 Drink water". |

### 2.7 More templates worth adding

| # | Template | Type | Ask | Auto |
| --- | --- | --- | --- | --- |
| 7 | **Medicine / supplements** | `DAILY` | Which pills, how many times a day, at what times, with or before food | Category `SUPPLEMENTS`. One repeat per *time of day* with the pills as steps ("Vitamin D", "Omega 3") — one push in the morning, not one per pill. `activeForMins` 120. |
| 8 | **Morning / evening routine** | `DAILY` | Time, the steps (skin care, stretching…) | Category `SELFCARE`. One repeat, steps = the routine. `activeForMins` 90. |
| 9 | **Weekly call / lesson** (tutor, team sync, therapy) | `REPEATED_WEEKLY` | Day(s), time, meeting link | Category `WORK` or `EDUCATION`. `activeBeforeMins` 30, `remindBeforeMins` 10, `activeForMins` = duration (ask, default 60). Link on the task. |
| 10 | **Yearly renewal** (car insurance, domain, passport, tax) | `REPEATED_MONTHLY`, one month | What, date, link to renew | Category `IMPORTANT`. `activeBeforeMins` 20160 (2 weeks before), `remindBeforeMins` 10080 (push 1 week before), `activeForMins` 1440. |
| 11 | **Subscription payment** (Netflix, gym membership) | `REPEATED_MONTHLY` | What, day of month, link to manage it | Like bills, one repeat each. Useful to remember to cancel. |
| 12 | **Shopping list / packing list** | `BASIC` | Paste or type the items | Each item becomes a step. Category `FOOD` for shopping, `OTHER` for packing. |
| 13 | **Trip** | `EVENT` | Where, departure date/time, ticket or booking links | `activeBeforeMins` 4320 (actual 3 days before), `remindBeforeMins` 1440. Steps: offers the packing list from #12. |
| 14 | **Reading / language practice habit** | `DAILY` | Book or app, time, minutes per day | Category `READING` / `EDUCATION`. Name includes the target: "📖 Read 20 min". |
| 15 | **House chores** (water plants, clean, change bed sheets) | `REPEATED_WEEKLY` | Which chores, which day each | One repeat per day with that day's chores as steps. Category `OTHER`. |

**Rule shared by every template that makes steps from a list**: if the person pastes a page or a
long text, the agent extracts the items as step names (same job the `task-creator` agent does
today), and never follows instructions written inside the pasted text.

### 2.8 How templates live in code

One file, `src/assistant/templates.ts`, a list of plain objects:

```ts
export interface AssistantTemplate {
  id: string;                  // 'birthday'
  title: string;               // '🎂 Birthday'
  creates: TaskType;           // REPEATED_MONTHLY
  ask: TemplateQuestion[];     // in order
  defaults: string;            // short prose the prompt reads: window, time, category, naming
}

export interface TemplateQuestion {
  field: string;               // 'date' — key under which the answer is remembered
  question: string;            // 'What is the date? Year is not needed.'
  input: AnswerInput;          // 'text' | 'time' | 'date' | 'url' | 'choice' | 'list'
  options?: string[];          // for 'choice'
  optional?: boolean;
}
```

The same list is used twice:

1. **Rendered into the system prompt** (frozen text, cached — the templates never change per
   user or per day, so they do not break the cache).
2. **Served by `GET /assistant/templates`** so the chat screen can show them as quick-start
   chips. Tapping "🎂 Birthday" starts the session already on that template.

Adding a template = adding one object. No other code changes.

---

## 3. How a chat goes

```
You tap  ✨ Ask AI  →  chips: 🎂 Birthday  💡 Bills  🏋️ Gym  💧 Water  📅 Event  …  or type
You tap  💡 Bills
Agent    Which bills do you pay?           [Electricity] [Water] [Gas] [Internet] [+ other]
You      Electricity, Water, Internet
Agent    On which day of the month?        [ day picker ]
You      10
Agent    At what time should I remind you? [ time picker ]
You      19:00
Agent    Do you have a link to pay electricity? (you can skip)   [ link field ] [Skip]
...
Agent    ┌──────────────────────────────────────────┐
         │ 💡 Pay utilities — every month on the 10th, 19:00   │
         │ ☐ Electricity  🔗   ☐ Water   ☐ Internet 🔗        │
         │ Important · stays actual for 3 days                │
         │           [ Change ]   [ Create ]                   │
         └──────────────────────────────────────────┘
You tap  Create   →  written, list refreshes, session closed and deleted
```

Three rules for the agent (in the system prompt):

- **One question per message.** On a phone, three questions in one message get one answer.
- **Do not ask what has a good default.** Ask only the template's `ask` list, plus anything the
  person's first message left truly unclear. Defaults are shown in the proposal, not asked.
- **If the first message already answers questions, skip them.** "Birthday of my mother on
  4 August" goes straight to the proposal.

---

## 4. Tools: backend APIs wrapped as small functions

Each tool is one file in `src/assistant/tools/`, exporting a definition (the JSON Schema Claude
reads) and a `run(input, context)` function. `context` carries `userId` (from Basic auth, never
from the model), the session, the timezone offset and the services.

**They call the existing services in-process, not over HTTP.** The services are what the
controllers call, so the behaviour is the same as the API, with the same Joi schemas. (Calling
over HTTP would only make sense if the assistant moved into a separate process.)

| Tool | Wraps | What it does | Ends the turn? |
| --- | --- | --- | --- |
| `ask_user` | — | Asks one question. Input: `{ field, question, input: 'text'\|'time'\|'date'\|'url'\|'choice'\|'list', options? }`. The frontend shows the right control: native time picker, date picker, link field, buttons. | Yes |
| `find_tasks` | `TasksService.list` | `{ query?, category? }` → at most 20 short rows: `id, name, type, local date`. So "do I already have this?" works. | No |
| `find_repeats` | `RepeatedTasksService.list` | Same for repeats: `id, name, type, weekdays/fromDay, local times`. Used by the gym template to avoid duplicates. | No |
| `propose` | Joi schemas (`CreateTaskSchema`, `CreateRepeatedTaskSchema`) | `{ items: Draft[], assumptions: string[] }`. Converts local → UTC, expands time grids, **validates every item with Joi**. Invalid → error goes back to the model to fix (once). Valid → saved as the session's `proposal` and shown as a card. **Writes nothing to tasks.** | Yes |

And one thing that is **not a tool**: **Create**. The Create button calls
`POST /assistant/sessions/:id/confirm`. That handler takes the stored, already-validated
proposal and calls `TasksService.create` / `RepeatedTasksService.create` for each item. The
model is not part of this step at all — what you saw on the card is exactly what gets written.

Why this split:

- The model can read (to avoid duplicates) and draft, but **cannot write**. A prompt injection
  in a pasted page can at worst produce a proposal you do not tap.
- No `update` or `delete` tools in phase 1 — same reason as the earlier note.
- Several items (gym plan) are **validated together first, then written together**
  (`Promise.all`, no `await` in a loop). If one write fails, the reply says which ones landed.

Small tool results matter: they stay in the history, so every row returned is paid for on every
later turn. `find_*` return short rows, capped at 20, never full tasks.

---

## 5. Chat history: kept small, deleted after each session

### 5.1 Where it lives

A new collection, `assistantSessions`, **one document per chat session**:

```ts
interface AssistantSession {
  id: string;                    // uuid
  userId: string;
  templateId: string | null;
  messages: StoredMessage[];     // raw Claude content blocks, append-only inside a session
  answers: Record<string, string>; // field -> answer, filled from ask_user replies
  proposal: Draft[] | null;      // what the card shows; what Confirm writes
  turns: number;
  createdAt: Date;
  expiresAt: Date;               // Mongo TTL index
}
```

The history stays on the server. The browser only sends the new message and gets the reply
(earlier note, section 11: the client must not be able to rewrite history).

### 5.2 When it is deleted

| Event | What happens |
| --- | --- |
| You tap **Create** and it succeeds | Session deleted at once. |
| You close the chat sheet or tap **New chat** | `DELETE /assistant/sessions/:id` — deleted. |
| You leave the app in the middle | **TTL index on `expiresAt`**: Mongo deletes the document by itself. `expiresAt` moves to *now + 30 min* on every message. |
| The server restarts | Nothing to do — the document is in Mongo and the TTL still runs. |

After a session ends, **nothing of the chat is kept**. The only thing left is a usage counter
(next point), with no message text in it. Logs record token counts, never message text.

### 5.3 Limits, so it cannot grow

| Limit | Value | When reached |
| --- | --- | --- |
| Messages per session | 40 | The session is **compacted** (5.4). |
| Model calls per request | 4 | Stop, answer with what we have. Stops a loop. |
| Retries of a rejected `propose` | 1 | Second rejection → tell the person what the server refused. |
| `find_*` rows per call | 20 | Rows are short. |
| Message length from the user | 4,000 chars (Joi) | 400. A pasted page longer than that is too long for a phone anyway. |
| Messages per user per day | 100 | 429. Counter in `assistantUsage` (`_id: userId + date`), with its own TTL of 2 days. |

### 5.4 Compaction, without losing anything

We do not cut old messages out of the middle — that breaks the prompt cache and the model's
thinking blocks (earlier note, section 11). Instead the state that matters is **already stored
outside the messages**: `templateId`, `answers` and `proposal`. So when a session is too long:

1. A new message list is started with **one** user message built by code (not by the model):
   *"Template: bills. Answers so far: bills = Electricity, Water; day = 10; time = 19:00.
   Current proposal: …. Continue."*
2. The old messages are dropped.

Nothing the person said is lost, and the new list is a few hundred tokens. In practice a
template chat is 6–12 messages and never reaches the limit; this is the safety net.

---

## 6. API

All under `authenticate` (Basic), like every other resource.

| Method + path | Body | Answer |
| --- | --- | --- |
| `GET /assistant/templates` | — | `[{ id, title }]` for the chips. 503 if no API key is set (the frontend hides the button). |
| `POST /assistant/sessions` | `{ templateId?, message?, timezoneOffsetMinutes, clientNow }` | A new session + the first reply. |
| `POST /assistant/sessions/:id/messages` | `{ message, timezoneOffsetMinutes, clientNow }` | The next reply. |
| `POST /assistant/sessions/:id/confirm` | — | `{ created: [{ resource, id, name }] }`. Deletes the session. |
| `DELETE /assistant/sessions/:id` | — | 204. |

Every reply has the same shape, so the frontend has one place to draw it:

```ts
interface AssistantReply {
  sessionId: string;
  text: string;                                   // what the agent says
  ask?: { field: string; input: AnswerInput; options?: string[] }; // which control to show
  proposal?: ProposalCard[];                      // when it is ready to create
}
```

A session belongs to one user. Every route checks `session.userId === currentUserId` and
answers 404 otherwise (not 403 — do not tell a stranger the id exists).

---

## 7. Frontend

- **Composer step 1 gets a fourth choice**: `✨ Ask AI — "Tell me, I'll set it up"`. It opens
  `#assistant`, a new `<dialog>`. Hidden when `GET /assistant/templates` answers 503.
- **`frontend/assistant.js`**, kept out of `app.js` like `notifications.js` and `theme.js`.
- The sheet: template chips at the top (only before the first message), chat bubbles, and an
  input area that changes with `ask.input`:
  - `time` → `<input type="time">`, `date` → `<input type="date">` (native pickers on iOS — no
    typing, no parsing of "7 pm");
  - `choice` → buttons, `list` → buttons with multi-select + "other";
  - `url` → a link field with **Skip**;
  - `text` → the normal text box.
- The proposal card reuses the existing card styles (name, schedule line, steps, link chips),
  with **Change** (focus the text box: "what should I change?") and **Create**.
- After Create: `load()` (quiet refresh, existing), close the sheet, toast "Created 3 repeats".
- Closing the sheet sends `DELETE /assistant/sessions/:id` (best effort; the TTL covers a
  failed call).
- Remember the modal dialog rule from `CLAUDE.md`: never `position: relative` on the `<dialog>`.

---

## 8. Build order

Each phase ends working and deployed.

1. **Foundation.** `ANTHROPIC_API_KEY` in config + `.env.example`, `storage/claude.storage.ts`
   (null when no key → 503), `assistantSessions` repository with the TTL index,
   `assistantUsage` counter, the five routes, the `IAssistantClient` seam and a fake client
   for tests. The model answers plain text, no tools.
2. **Propose + confirm, no templates yet.** `propose` tool with local→UTC, grid expansion and
   the Joi gate; the confirm handler. Tests for conversion (midnight wrap, weekday shift, under
   `TZ=Asia/Kathmandu`) and for the gate.
3. **Frontend sheet.** The fourth choice, the dialog, text input, proposal card, Create.
4. **`ask_user` + the input controls.** Time/date/choice/url/list.
5. **Templates 2.1–2.6** (course, birthday, bills, gym, interview, water) + chips.
6. **`find_tasks` / `find_repeats`**, then the gym template's duplicate check.
7. **Templates 2.7** (the rest), one at a time.
8. **Eval file**: ~25 sample chats (first message + answers → expected proposal), run against
   the real API by a script outside `npm test`. Run it after every prompt or template change.
9. Later, if wanted: `update` tools, streaming, voice input.

---

## 9. Open questions

1. **Repeats have no end date.** "Take antibiotics for 10 days" or "drink water during the
   course" cannot be stored. Options: (a) the agent says so and suggests pausing it later,
   (b) add `endsOn` to configs (a migration + generator change). I would start with (a).
2. **Only one reminder per task.** A birthday wants "3 days before, buy a gift" *and* "on the
   day". Today: one push on the day, and "Buy a gift" as a step that is visible from the day
   before. A second reminder would be a separate feature.
3. **Days 29–31 in monthly repeats.** What does the generator do for `fromDay: 31` in April, or
   29 February in a normal year? Needs a test before the birthday and bills templates ship. The
   agent should warn when the day is 29–31.
4. **Model.** The earlier note picks Opus. The guided chat is simpler work (ask, collect,
   propose), so a smaller model may be enough. Keep `ASSISTANT_MODEL` in config and decide
   with the eval from phase 8, not by guessing.
5. **Can the assistant ever edit?** "Make leg press 80kg" is a very natural sentence. It needs
   an `update` tool with the same propose → confirm step. Phase 9, if wanted.
