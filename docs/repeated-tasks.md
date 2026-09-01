# Repeated tasks — my understanding

This is what I took from your explanation, written back with worked examples so you can correct
it. Anything I was unsure about is an open question at the bottom, each with the answer I would
pick by default — so you can reply "defaults are fine" or correct just the ones that are wrong.

## Decided so far

Folded into the sections below; the questions they came from are marked ANSWERED.

1. **Daily cadence is a fixed grid** from `startsAt`, stepping by `repeatEach`. After 13:00 comes
   15:00, not 14:00. (Q1)
2. **`EventTask` gains `configTaskId: string | null`** — the config that generated it, or `null`
   for a hand-made event. (Q2)
3. **No time-of-day field on weekly or monthly configs.** Generated weekly events are at **00:00**
   on the weekday; generated monthly events are on **`fromDay` at 00:00**. (Q3)
4. **Monthly generates one event per listed month**, on `fromDay` — not one per day of the
   range. (Q4)
5. **All automatic behaviour runs in the existing poller** — marking passed and generating the
   next occurrence, alongside the notification pass it already does.
6. **Filter logic lives in `src/filters/tasks.filters.ts`**, one named function per rule, so each
   case can be reviewed on its own. Nothing is inlined into the controller or repository.
7. **Everything is UTC** — every window boundary, and every date in the tests. (Q6)

## 1. Two different kinds of thing

| | What it is | Does the user complete it? |
| --- | --- | --- |
| `BASIC` | A standalone to-do. | Yes |
| `EVENT` | A to-do that happens at a specific `date`. | Yes |
| `REPEATED_DAILY` / `REPEATED_WEEKLY` / `REPEATED_MONTHLY` | **A config.** A rule that generates event tasks. | No — it is never "done" |

The repeated types are not tasks the user ticks off. They are the recipe. The user only ever
acts on `EVENT` tasks, some of which were typed in by hand and some of which a config produced.

## 2. The generation invariant

> Each config has **exactly one** generated event that has not passed yet.

Call it the config's **pending event**. The cycle:

1. A config is created → immediately generate its next occurrence as an event task.
2. Time passes that event's date → mark it passed, and generate the following occurrence.
3. The passed event **stays**. It is not deleted and not auto-completed — the user decides what
   to do with it (finish it, delete it, ignore it).

So a config that has been running for a day leaves a trail of passed events behind it, plus
exactly one pending event ahead of it.

**Important:** "pending" is not the same as "shown under the `actual` filter". Generation
always runs ahead; the filter decides what is worth showing. Section 4 is where they diverge.

## 3. Which occurrence comes next

### Daily

Occurrences sit on a grid: from `startsAt`, stepping by `repeatEach`, up to and including
`endsAt`. Past `endsAt`, the grid restarts at `startsAt` the next day.

> Config: "drink water", `startsAt` 09:00, `endsAt` 23:00, `repeatEach` 2h
> Grid: 09:00, 11:00, 13:00, 15:00, 17:00, 19:00, 21:00, 23:00 → 09:00 tomorrow

| Now | Pending event | Why |
| --- | --- | --- |
| 11:45 | today 13:00 | next grid point after now |
| 13:01 | today 15:00 | 13:00 passed, so the next was generated |
| 23:01 | **tomorrow** 09:00 | end of today's window, so the grid restarts |

### Weekly

The config lists `weekdays`. The pending event is the next listed weekday after now, **at
00:00** — weekly configs carry no time of day.

> Config: "gym", `weekdays` [1, 5] (Monday, Friday)
> Friday's 00:00 event passes → the pending event becomes next Monday 00:00.

### Monthly

The config lists `months` and a `fromDay`–`toDay` range. It generates **one event per listed
month, on `fromDay` at 00:00** — not one event per day of the range.

> Config: "pay rent", `fromDay` 1, `toDay` 5, `months` [1, 2, 3]
> Events: 1 January 00:00, then 1 February 00:00, then 1 March 00:00.

`toDay` therefore does not affect generation at all under this rule — see Q14.

## 4. The `actual` / `passed` / `upcoming` filter

`GET /tasks?filter=actual` (or `passed`, `upcoming`). No `filter` param → everything, as today.

Evaluated in this order, for an event task:

0. **A task with no date is always `actual`** — nothing makes it pass and nothing
   makes it wait. Leaving it out of every filter made a plain to-do invisible in an app
   whose list is always filtered.
1. **`passed`** — its date is in the past (`passedDate` is set).
2. **`actual`** — not passed, and its date falls inside the window its `activeLogic` defines.
3. **`upcoming`** — not passed, but outside that window.

So `actual` means *"relevant right now"*, and `activeLogic` is what "right now" means for that
event. The three windows, all measured from today:

| `ActiveLogic` | Window | Used by |
| --- | --- | --- |
| `TODAY` | today only | daily configs |
| `THIS_WEEK` | today → Sunday (the rest of *this* week, never into next week) | weekly configs |
| `NEXT_30_DAYS` | today → today + 30 days, rolling — **never** the calendar month | monthly configs |

### Why the windows exist — your two examples

**Daily, at 23:30.** The 23:00 event passed, so the pending event is tomorrow 09:00. It exists,
but `TODAY` excludes it, so `filter=actual` shows nothing for this config. Correct: there is
nothing left to drink today. It appears under `upcoming`.

**Weekly, on Saturday.** Friday's event passed, and Monday's is already generated. `THIS_WEEK`
runs today → Sunday, and Monday falls outside it, so `filter=actual` hides it — the new week has
not started. On Monday the same event is inside the window and becomes `actual`.

**Monthly.** A rolling 30 days, deliberately not "this month". On 19 August, an event on
1 September is `actual` (13 days out) even though it is a different calendar month. An event on
25 September is `upcoming` (37 days out).

## 4b. The filter functions, and what each one decides

`src/filters/tasks.filters.ts`. Read top to bottom:

| Function | Decides |
| --- | --- |
| `startOfDay` / `endOfDay` | the day's edges, in the server's timezone |
| `endOfThisWeek` | where this week stops — the coming Sunday, 23:59:59.999 |
| `endOfNext30Days` | the rolling 30-day horizon |
| `isEventTask` / `isRepeatedTask` | which tasks a filter can even apply to |
| `activeLogicForRepeatedTask` | daily → TODAY, weekly → THIS_WEEK, monthly → NEXT_30_DAYS |
| `isWithinToday` | the daily window |
| `isWithinThisWeek` | the weekly window |
| `isWithinNext30Days` | the monthly window |
| `isWithinActiveWindow` | dispatches an event to its own window |
| `hasDatePassed` | the moment has gone by |
| `isMarkedPassed` | the poller has stamped `passedDate` |
| `isPassedEvent` / `isActualEvent` / `isUpcomingEvent` | the three states |
| `isGeneratedEvent` | came from a config rather than a client |
| `eventsOfConfig` / `pendingEventOfConfig` | the generator's "one pending event" invariant |
| `matchesTaskFilter` / `filterTasks` | applies a filter to a list |

`now` is always a parameter, never read from the clock inside a rule, so every case above can be
checked at a fixed instant.

**Passed is decided from the date, not from `passedDate`.** The poller stamps `passedDate` up to
a minute late; a filter trusting the stamp would call a just-expired event actual until the next
pass. `isMarkedPassed` exists for when you want the stored flag specifically.

## 5. Where this runs

The 1-minute poller already exists (`EventPollingService`). Each pass would do, in order:

1. **Mark passed** — every event whose date is now in the past gets `passedDate` set.
2. **Generate** — for every config whose pending event just passed, create the next occurrence.
3. **Notify** — the existing console notification for events that just came due.

Plus generation at config-create time, so a new config has a pending event immediately rather
than up to a minute later.

## 6. What the code does not have yet

Facts, not opinions — these are gaps I hit reading the current types:

- **Nothing links a generated event back to its config yet.** Decided: add
  `configTaskId: string | null` to `EventTask`. Without it the server cannot tell which config a
  pending event belongs to, cannot enforce "one pending event per config", and cannot resume
  correctly after a restart.
- **Weekly and monthly configs have no time of day, and will not get one.** Generated events use
  00:00 (weekly) and `fromDay` 00:00 (monthly).
- **`passedDate` and `activeLogic` are on `EventTask` but not in the schemas**, so `npm run
  typecheck` is currently failing on `CreateEventTaskSchema`. `StrictSchemaMap<CreateEventTask>`
  demands every field, and those two are missing. The fix depends on Q10 — whether the client
  sends them or the server owns them.

## Open questions

Each has the answer I would pick. Correct the ones that are wrong.

**Q1 — Daily cadence. ANSWERED: fixed grid.** After 13:00 comes 15:00; the 14:00 in your message
was a slip. Occurrences sit on a grid from `startsAt` stepping by `repeatEach`.

**Q2 — Linking events to configs. ANSWERED: yes.** `EventTask` gains
`configTaskId: string | null` — the generating config's id, or `null` for a hand-made event.

**Q3 — Time of day for weekly and monthly. ANSWERED: no such field.** Weekly generated events are
at 00:00 on the weekday; monthly generated events are on `fromDay` at 00:00.

**Q4 — Monthly `fromDay`–`toDay` range. ANSWERED: reading (a).** One event per listed month, on
`fromDay`. Not one per day of the range.

**Q5 — Done before its time. STILL OPEN — I do not think your answer matched this question.**
You said "by default we should use it like month logic", but Q5 was about *when to generate the
next occurrence*, which has no month/day dimension. Two readings, and they do different things:

  - **(a) You were answering Q10** — that the default `activeLogic` for an event should be
    `NEXT_30_DAYS` ("month logic") rather than the `TODAY` I proposed. If so, Q5 is still
    unanswered and Q10 is settled.
  - **(b) You meant Q5 literally** — but then I cannot see what "month logic" would mean for it.

The Q5 case, concretely: a daily config's pending event is due **13:00**, and at **12:10** the
user marks it DONE. Do we
  - generate the 15:00 event immediately, so there is always a pending event that is not done, or
  - wait until 13:00 passes, leaving the config with nothing pending for 50 minutes?
Your phrasing "one active task **which is not done yet**" pointed me at the first.

**Q6 — Timezone. ANSWERED: UTC only.** Every boundary — day, week, 30-day horizon — starts and
ends at UTC midnight, and the whole test suite builds its dates in UTC. Original question kept
below for context.

**Q6 (original) — Timezone.** "Today", "until Sunday" and "next 30 days" are local-time ideas, but dates are
stored as UTC. Whose day boundary counts? I assumed the server's local timezone for now, with
per-user timezones as a later concern. If a user in UTC+4 asks for `actual` at 01:00 local, that
is still the previous UTC day — do you care yet?

**Q7 — Where does the week end?** `weekdays` uses 0 = Sunday, which reads as Sunday *starting*
the week, but `THIS_WEEK` runs "until Sunday", which reads as Sunday *ending* it. I assumed
Monday→Sunday for the window. Also: if today is Sunday, is the window just today (one day), or
the whole week ahead?

**Q8 — Downtime.** The server is off from Friday to Monday. A daily config's pending event was
Friday 13:00. On restart, do we generate only the next occurrence from now (Monday), or backfill
every occurrence that was missed over the weekend? I assumed **only the next one** — backfilling
would create ~30 events per config per day of downtime.

**Q9 — Do configs show up in `GET /tasks`?** They are tasks, so presumably yes with no filter.
But they have no date, so they cannot be `actual`, `passed` or `upcoming`. I assumed a filtered
list returns **only event tasks**, and configs appear only in the unfiltered list. Should there
be a way to list configs specifically?

**Q10 — `activeLogic` and `passedDate` on a hand-made event.** When a client POSTs an `EVENT`
directly, does it choose `activeLogic`, or does the server default it? I would make `passedDate`
server-owned (never sent by the client, always starts `null`) and `activeLogic` optional with a
default of `TODAY`. This is what is blocking typecheck, so it is the one I most need answered.

**Q11 — Editing and deleting a config.** If a config is edited (PUT) while it has a pending
event, is that event regenerated to match the new rule, or left alone? And when a config is
deleted, do its generated events go with it, or stay (with `configId` pointing at nothing)? I
assumed regenerate on edit, and **keep** the events on delete — the passed ones are the user's
history.

**Q12 — Can a config be paused?** `status` exists on every task including configs. Does a config
with `status: DONE` mean "stop generating"? That would be a natural pause switch, but right now
nothing reads it.

**Q13 — Retention.** A daily config with a 2-hour cadence produces 8 events a day, forever, in a
single JSON file. Do passed events get cleaned up after some period, or is that a later problem?

**Q14 — What is `toDay` for now? ANSWERED: reading (c) then (b).** `toDay` is gone. It was
collected, validated and stored, and nothing ever read it — the form promised a window it did
not deliver. Its successor is `activeForMins`, a duration on *any* dated task rather than a
day range on monthly alone: how long the task stays actual after its moment, ten minutes by
default. Migrated by `backend/scripts/2026-08-21-active-for-mins.ts`, which turns days 8–12
into the 6660 minutes from the occurrence to the end of day 12.

**Q14 (original) — What is `toDay` for now?** With one event generated on `fromDay`, `toDay` no longer
affects anything. Three uses I can imagine: (a) nothing yet, keep the field for later; (b) a
deadline — the event stays actual until `toDay` even if its date has passed; (c) drop the field.
I assumed (a) and left it stored but unused.

**Q15 — A 00:00 event is never actual on its own day.** This falls out of Q3 and I do not think
you want it. Weekly "gym" on Friday generates Friday 00:00. Verified behaviour:

  - Tuesday and Thursday → **actual** (inside this week, still ahead)
  - Friday 00:00:00 → **passed** (`date <= now` is already true)
  - Friday 09:00 → **passed**

So on the very day the user should go to the gym, the task reads as passed. Monthly has the same
shape but it matters less, since it is actual for up to 30 days beforehand. Two ways out: give
these events a real time of day after all (reversing Q3), or make "passed" day-granular for
midnight events — an event dated 00:00 counts as passed only once its day is over. I would take
the second, but it is your call.

---

# Before implementing generation

The read side is done. These are what the write side needs.

## Answered

- **B1 — generated events land at a fixed time of day**, not midnight. Weekly and monthly configs
  still carry no time of day (Q3); `GENERATED_EVENT_TIME` is one constant in the generator. This
  is the cheap fix for the "passed all through its own day" problem — no new field, no special
  passed-rule. Promote it to a per-config field later if needed.

  The constant is **02:00 UTC**, which is **06:00 in Yerevan** — early enough that a morning
  routine is in the list while it is being done. It was 09:00 UTC (13:00 local) until
  2026-09-01, which put a gym session in the list around lunchtime. The generator writes it as
  `GENERATED_EVENT_HOUR_LOCAL - YEREVAN_OFFSET_HOURS` so the hour that was actually chosen stays
  readable; keep the local hour at or above the offset, or the UTC hour goes negative and the
  occurrence lands on the day before. Moving it needs
  `backend/scripts/2026-09-01-config-subtasks.ts`, which clears pending weekly and monthly events
  so the poller remakes them at the new hour — nothing rewrites an event once generated.
- **B2 — no timezone handling.** Everything stored is UTC. The one exception is
  `GENERATED_EVENT_TIME` above, which is a time chosen *for a person* and so is only meaningful
  in their clock; Armenia has been UTC+4 the year round since it dropped DST in 2012.
- **Steps on a config.** A config carries `subtasks`, and every occurrence it generates starts
  with a copy — fresh ids, all TODO. They are `RepeatedSubtask`, a `Subtask` *without* `status`,
  for the same reason a config has no status of its own: nobody completes a rule, and last
  week's gym session being finished says nothing about this week's. Posting a step with a
  `status` to `/repeated-tasks` is a 400. This exists because `PUT /tasks/:id` refuses a
  generated event's subtasks (they would be overwritten by the next regeneration), so a
  recurring checklist has nowhere else to live.
- **B3 — generate immediately on early completion.** Marking the pending event DONE produces the
  next occurrence right away, so the update path triggers generation, not only the poller.
- **B5 — editing a config wipes and regenerates.** On PUT, delete every event linked to that
  config and generate fresh from the new rule. On DELETE, remove the config and its events
  outright — no soft delete. One shared builder writes the name/subtasks, so that logic is not
  duplicated between "create" and "regenerate".
  - *Consequence to be aware of:* this deletes **passed** events too, so a config's completed
    history disappears when its schedule is edited.
- **B6 — status is not editable on a config.** Only the status of a generated event can change.
  So a config has no pause switch: stopping it means deleting it.

- **B4 — taken as (a), no backfill.** After downtime the next pass generates only the next
  occurrence from now. A weekend offline produces nothing rather than a wall of missed reminders.
  Say the word if you want catch-up instead; it is a loop where there is currently one call.
- **Timezones — parked** until the frontend exists and you can see how it behaves. Everything is
  UTC in the meantime, so nothing has to be undone.

## Configs live in their own store

Configs live in their own `repeatedTasks` collection, behind their own `/repeated-tasks`
resource. (Both stores were JSON files first; they are MongoDB collections now.) `GET /tasks` now returns only basic tasks and events — which loses
nothing, because every config is represented there by the event it currently has pending.

What it bought:

- `Task` is `BasicTask | EventTask`, so `matchesTaskFilter` no longer needs a "configs never
  match" branch and `isRepeatedTask` is gone entirely. Q9 stops being a question.
- Reading configs on every poll no longer means parsing a file full of generated events.

What to watch:

- **No cross-store atomicity.** Deleting a config touches both files. It deletes **events first**
  so a crash in between is self-healing (the config still exists, so the next poll regenerates);
  the other order would strand events pointing at a config that is gone.
- **Existing local data.** Anything written before the move to Mongo lived in `data/*.json` and
  is not read any more. Drop the folder; the collections start empty.

## Implemented

- `src/generators/occurrences.generator.ts` — when the next occurrence falls, per config type.
- `src/services/task-generator.service.ts` — marking passed, keeping one pending event per
  config, regenerating after an edit, generating the follow-up after an early finish.
- The poller now runs **mark passed → generate → notify** each minute.
- `TasksService` hooks: creating a config generates its first event immediately; editing one wipes
  and regenerates; deleting one takes its events with it; marking a generated event DONE brings the
  next occurrence forward.

- `GET /tasks?filter=actual|passed|upcoming` is wired, validated, and filtering through the rules
  in `tasks.filters.ts`. No filter still returns everything, basic tasks included.

- B6 is enforced (`src/rules/task-update.rules.ts`): a generated event accepts a status change
  and nothing else, and a config's status cannot change. Edits go on the config, which
  regenerates.

Still not wired: the B10/B12 schema validation (zero `repeatEach`, `startsAt` after `endsAt` are
still accepted at creation, though the generator refuses to fire on them).

## Still open

## Blocking — these change the algorithm or the data

**B4 — Downtime, restated with numbers.** The daily "drink water" config runs every 2h, so it
produces 8 events a day. Suppose the server is switched off on Friday evening and started again on
Monday morning. Nothing generated over the weekend, because nothing was running.

On Monday startup, which of these should happen?

  - **(a) Only the next one.** Create a single event for the next grid point (say Monday 09:00)
    and carry on. The weekend simply produced nothing. — my default
  - **(b) Catch up.** Create every occurrence that *would* have been generated — roughly 24 events
    dated across Saturday and Sunday, all already passed, so the user opens the app to a wall of
    missed water reminders.

Same question for a weekly config: back after two weeks off, do you want the two missed sessions
recorded as passed events, or just the next upcoming one?

## Shape of a generated event

**B7 — What does it look like?** I would copy the config's `name` verbatim ("drink water"), set
`status: TODO`, `subtasks: []`, `configTaskId` to the config's id, `activeLogic` from the config
type (daily→TODAY, weekly→THIS_WEEK, monthly→NEXT_30_DAYS), and `passedDate: null`. Should the
name carry the occurrence time, e.g. "drink water 13:00"?

**B8 — How does it get stored?** `repository.create()` takes a `CreateTask`, which deliberately
excludes `configTaskId`. Generation needs its own path — I would add
`createGeneratedEvent(config, date)` to `ITasksRepository`. Confirm the interface addition.

**B9 — Are generated events notified?** They will flow through the existing poller notification,
so the user gets a console line each time one comes due. I assume that is the intent.

## Edge cases I will otherwise decide myself

**B10 — `repeatEach` of zero.** `{hour: 0, minute: 0}` currently passes validation and would loop
forever generating occurrences. I would reject it in the schema (minimum one minute).

**B11 — Daily window that does not divide evenly.** 09:00 to 23:00 every 4h gives 09, 13, 17, 21
— 23:00 never happens. I assume the last occurrence is the last grid point at or before `endsAt`.

**B12 — `startsAt` after `endsAt`.** Still unvalidated (noted in the schema). I would reject it.

**B13 — `fromDay` 31 in a 30-day month.** February with `fromDay: 31`. Skip that month, or clamp
to the last day? I would clamp to the last day of the month.

**B14 — Weekly frequency.** Every listed weekday, every week, with no "every other week" concept.
Confirming that is all you want.
