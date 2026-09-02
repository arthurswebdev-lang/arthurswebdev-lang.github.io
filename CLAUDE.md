# tasks-api

A PWA and its API in one repository, deployed to two places:

- `frontend/` — static PWA published to **GitHub Pages** by a workflow, installed to the iOS
  home screen. Path- and scope-sensitive: see *Frontend* below.
- `backend/` — the API, deployed to **fly.io**.
- `docs/` — design notes shared by both.

**Every path below is relative to `backend/`**, and every `npm` command runs from there.

Express 5 + TypeScript (ESM, NodeNext) todo/tasks API, backed by MongoDB via the native driver.
Layering: `routes → validation middleware → controller → service → repository`, each layer
receiving its dependency through the constructor, composed in `app.ts`.

## Write to the rules, do not lint-then-fix

The rules below are **authoring constraints**. Write code that already satisfies them; do not
write it loosely and clean up afterwards with `--fix` or by reacting to error output. Run
`npm run lint` and `npm run typecheck` to *confirm* the work, not to discover how it should
have been written.

Prefer restructuring code over silencing a rule. `eslint-disable` comments are not used in
this repo — where a rule genuinely does not apply to a file, add a scoped override in
`eslint.config.ts` with a comment explaining why (see the existing overrides for `server.ts`,
`console-notification.service.ts` and `eslint.config.ts`).

### ESLint rules that actually bite

| Rule | What to do |
| --- | --- |
| `max-lines-per-function` (max 25, blanks/comments not counted) | Extract helpers early. Long `switch`es and route registration hit this fastest. |
| `@typescript-eslint/restrict-template-expressions` (**no numbers, booleans, any, nullish**) | Wrap non-strings in a template literal: `` `port ${String(port)}` ``. This one is easy to forget. |
| `@typescript-eslint/no-extraneous-class` | No static-only utility classes. Export plain functions and import the module as a namespace: `import * as SuccessHandlerUtil from '...'`. |
| `@typescript-eslint/consistent-type-definitions: interface` | Declare object types as `interface`, not `type X = { ... }`. Exception, already in the codebase: Express route params must be a type alias (see Gotchas). |
| `@typescript-eslint/consistent-type-imports` (inline style) | `import { type Foo } from 'x'` / `import type { Foo } from 'x'` for type-only imports. |
| `@typescript-eslint/no-unnecessary-condition` | No defensive checks the types rule out. With `exactOptionalPropertyTypes`, `'key' in obj` is enough — do not also compare against `undefined`. |
| `@typescript-eslint/no-unnecessary-type-parameters` | A type parameter used only once is not a generic. Use the concrete type (`data: object`, not `<T>(data: T)`). |
| `@typescript-eslint/require-await` | A method with no `await` must not be `async`. Return the promise directly: `return this.repo.list();`. |
| `@typescript-eslint/no-misused-promises` / `no-floating-promises` | Never hand an async callback to `setInterval`/`setTimeout`. Wrap it: `setInterval(() => { void this.tick(); }, ms)`. |
| `@typescript-eslint/await-thenable` | Keep async interfaces returning `Promise<void>` rather than `void \| Promise<void>`, or `Promise.all` over the results is rejected. |
| `@typescript-eslint/no-non-null-assertion` | No `!`. Narrow instead: assign to a const and check for `undefined`. |
| `@typescript-eslint/switch-exhaustiveness-check` | `switch` over a union/enum must cover every case. This is a feature — it is what makes the `Task` union safe. |
| `@typescript-eslint/no-unused-vars` (`^_` exempt) | Unused params keep their position but take a leading underscore: `(_request, response, next)`. Express error handlers need all four. |
| `@typescript-eslint/naming-convention` | Variables camelCase/PascalCase/UPPER_CASE, functions camelCase/PascalCase, types PascalCase. |
| `@stylistic/comma-dangle: always-multiline` | Trailing comma on every multiline literal, param list, import and **enum member**. |
| `no-await-in-loop` | Never `await` inside a loop. Read once, decide from that snapshot, then `Promise.all` the writes — faster, and it avoids each iteration deciding against a store an earlier one already changed. |
| `n/no-sync` | No `*Sync` fs calls. Use `node:fs/promises`. |
| `import-x/no-extraneous-dependencies` | Nothing under `src/` may import a devDependency. |
| `eqeqeq` (null ignored) | `===`, except `== null` when you mean null-or-undefined. |
| `no-console` (warning; `warn`/`error` allowed) | `console.log` only in files with an override. Logging an error? `console.error`. |

### TypeScript strictness that shapes the code

- **`verbatimModuleSyntax` + NodeNext**: every relative import ends in `.js`, even though the
  source is `.ts` (`'./config.js'`). The `import-x/extensions` rule is off for this reason.
- **`exactOptionalPropertyTypes`**: `foo?: string` means the key may be *absent*, never present
  and `undefined`. Build objects conditionally rather than assigning `undefined`.
- **`noUncheckedIndexedAccess`**: `array[i]` is `T | undefined`. Assign then check; no `!`.
- **`noPropertyAccessFromIndexSignature`**: `process.env['PORT']`, not `process.env.PORT`.
- **`useUnknownInCatchVariables`**: `catch (error)` gives `unknown`. Narrow with `instanceof`.
- **`noUnusedLocals` / `noUnusedParameters`**: same underscore convention as ESLint.

### Not enforced — match the surrounding code

There is no `max-len`, `quotes`, `indent` or `semi` rule configured. Formatting is convention,
not automation: single quotes, semicolons, 2-space indent, lines wrapped around 100 columns,
one blank line before a `return` that follows logic.

## Conventions

- **Files**: `*.controller.ts`, `*.routes.ts`, `*.service.ts`, `*.repository.ts`,
  `*.middleware.ts`, `*.types.ts`, `*.enum.ts`, `*.util.ts`, `*-*.interface.ts`.
  Directories are plural: `controllers/`, `routes/`, `services/`, `repositories/`,
  `interfaces/`, `types/`, `utils/`, `schemes/`, `middlewares/`, `enum/`.
- **Joi schemas live in `src/schemes/`** — they are not middlewares. Validation *middlewares*
  live in `src/middlewares/validation/`. `common.schemes.ts` holds the shared field vocabulary
  both resources build on.
- **A third collection, `devices`, holds push registrations** — one row per FCM
  token, unique on the token so re-registering a browser updates rather than
  making every alert arrive twice. `POST /devices` is the only endpoint; dead
  tokens are deleted by `FcmNotificationService` when FCM rejects them, not by a
  route. See `docs/push-notifications.md`.
- **Two resources, two collections.** `/tasks` (`tasks`) holds `BASIC` and `EVENT`;
  `/repeated-tasks` (`repeatedTasks`) holds the configs. The `Task` union is
  `BasicTask | EventTask` — configs are deliberately outside it, so a config can never reach
  task-filtering code. Posting a config to `/tasks` is a 400.
- **The two collections are not written atomically** (no transactions — a standalone mongod has
  none). Where an operation spans both, order it so a crash in between fails safe: deleting a
  config removes its **events first**, so an interruption leaves a config whose events the next
  poll regenerates, rather than events orphaned forever.
- **Mongo, following the hapi-minimal boilerplate.** `MongoStorage` owns the connection and hands
  a `Db` to each repository's constructor; `MongoRepository` is the shared CRUD base. Deviation
  from the boilerplate: `_id` is a **uuid string**, not an `ObjectId`, because ids are uuids
  everywhere else here (route validation, `configTaskId`, Postman). The repository maps `_id` to
  the domain's `id`, so nothing above it sees a Mongo shape.
- **Dependencies are built after connecting.** `createContainer(db)` and `createApp(container)`
  are functions, not module-level constants, because repositories need a live `Db`.
- Schemas are typed through `JoiObject<T>` so `StrictSchemaMap<T>` forces full field coverage.
  Variant schemas are built from shared field definitions in `fields`.
- **A generated event only accepts a status change.** Its name, date, window and subtasks
  come from its config and would be overwritten by the next regeneration, so `PUT /tasks/:id`
  rejects them with a 400 naming the offending fields and pointing at the config. Hand-made
  events (`configTaskId: null`) are unaffected — there is no config to edit instead. A config's
  own `status` is likewise fixed: it is a rule, not a to-do. Both rules live in
  `src/rules/task-update.rules.ts`, one function each.
- **Editing a repeat regenerates its occurrences only when the *schedule* moves.**
  `scheduleOf` in `src/rules/repeated-task-schedule.rules.ts` reduces a config to the fields that
  decide *when* it fires — weekdays, or fromDay+months, or the daily window — and an edit is
  compared against that. Change the name, links, category, steps or window and the dates are all
  still right, so the waiting occurrences are **rewritten in place**
  (`refreshEventsOfConfig`) rather than deleted. Note the window fields are *not* part of the
  schedule: they change how long an occurrence matters, never when it falls.
- **Nothing that has been started is ever rewritten or thrown away.** `isUnstartedEvent` — status
  TODO and no step ticked — is the line between an occurrence that is still a plan and one that
  is a record. Both paths only touch unstarted, unspent occurrences, which is why editing a
  repeat no longer erases the sessions you already did. `DELETE /repeated-tasks/:id` still
  removes everything: there the config itself is gone.
- **`PATCH /repeated-tasks/:id` changes only the fields it names**, merging onto the stored config
  and re-validating the result with the full create schema — so a patch cannot assemble a config
  a create would have refused (`weekdays` on a daily config, a reminder before the task is
  visible). `type` is accepted but cannot change. PUT still replaces; both reconcile events the
  same way.
- **PUT replaces, it does not merge.** `UpdateTaskSchema` is `CreateTaskSchema`: a PUT body is
  the full task representation, and a field the client omits falls back to its default rather
  than keeping its stored value. Only `id` and `createdAt` survive an update. `type` must match
  the stored task — a task cannot change variant in place.
- **Categories are fixed in code** (`TaskCategory`), not data — there are no endpoints to manage
  them. Anything created without one lands in `OTHER`, which keeps the field non-nullable and
  makes "uncategorised" filterable like any other value.
- **A generated event inherits its config's category, links, window and `subtasks`.** It
  has to: PUT refuses generated events, so whatever the occurrence needs to be useful — the call
  link, the category it groups under, the checklist to work through — can only come from the
  config. A config's steps are `RepeatedSubtask`: a `Subtask` minus `status`, because a config is
  a rule and nobody completes a rule. Each occurrence gets its own copy with fresh ids and
  everything TODO, so ticking last week's leaves this week's alone.
- **Weekly and monthly occurrences land at `GENERATED_EVENT_TIME`**, one constant in
  `occurrences.generator.ts`: 02:00 UTC, written as `GENERATED_EVENT_HOUR_LOCAL -
  YEREVAN_OFFSET_HOURS` because what was actually chosen is **06:00 in Yerevan**. Keep the local
  hour at or above the offset — below it the UTC hour goes negative and the occurrence slides to
  the previous day. Daily configs are unaffected: they use the times the user typed, which are
  read as UTC, so a daily window of 09:00–23:00 really runs 13:00–03:00 local.
- **Links are http(s) only** and capped (20 per task, 2048 chars). They get opened, so a
  `javascript:` or `file:` URL has no business being stored. Tasks carry `links: string[]`;
  a subtask carries at most one.
- **`GET /tasks?category=…`** narrows in the Mongo query (plain equality, indexed), while
  `filter=` stays in the rule functions. Neither is required; together they intersect.
- **A dateless task (`BASIC`) counts as `actual`.** A filter names a position in time and it
  has none, so it is always relevant; excluding it from every filter hid plain to-dos entirely.
- **A dated task carries three durations, not a calendar window** — `TaskWindow` in
  `tasks.types.ts`, all in minutes from the task's own `date`:
  `remindBeforeMins` (when the push is sent), `activeBeforeMins` (when it stops being upcoming)
  and `activeForMins` (when it becomes passed). `remindAt`, `activeFrom` and `activeUntil` in
  `tasks.filters.ts` are the only places that arithmetic is written — there are now four instants
  on an event, and picking the wrong one is the easiest mistake in the file. Generation asks
  about `date` (`hasDatePassed`); the list asks about the window (`isPassedEvent`); the poller
  asks about `remindAt`.
- **`remindBeforeMins` must not exceed `activeBeforeMins`**, or a push would arrive while the
  task is still hidden under upcoming. Enforced by `assertWindowOrder`, which wraps each dated
  schema. It is an object-level `.custom()` and not a `Joi.ref` on purpose: a ref resolves
  against the raw body, where a defaulted key is simply absent.
- **This replaced `ActiveLogic`** (TODAY / THIS_WEEK / NEXT_10_DAYS), three UTC-midnight windows
  chosen from a task's *type* rather than from the task. They could not say "an hour before",
  they behaved differently depending on which day you asked, and five weekly configs sharing a
  week all read as actual on Monday morning. Migrated by
  `backend/scripts/2026-09-01-task-windows.ts`.
- **`GET /tasks?filter=actual|passed|upcoming`** filters in the service, using the rules in
  `src/filters/tasks.filters.ts`, not in the Mongo query — the three states are one interval
  each, and worth reading as functions rather than as an aggregation pipeline. `passed` alone
  could move into the query if the collection grows.
- **Query params go through `validateQuery`, never `validate`.** Express 5 re-parses `req.query`
  on every read, so the validated copy must be pinned back with `defineProperty`.
- **Services that ask "what is true now" take a clock.** `TasksService` receives
  `now: () => Date`, for the same reason the filter rules take `now` as an argument: behaviour at
  a given instant has to be checkable at that instant.
- Controllers stay thin: call the service, hand the result to `SuccessHandlerUtil`, and
  `next(error)` from a `catch`. Existence checks belong in the service, which throws
  `ResourceNotFoundError`; the error handler middleware turns exceptions into JSON responses.
- Errors extend `HttpException` and carry an `HttpStatusCodes` value.

## Gotchas worth remembering

- **Express 5 `req.query` is a re-parsing getter.** Mutating it is silently discarded — use
  `validateQuery(request, schema)`, which validates a copy and pins it with `defineProperty`.
  `req.body` and `req.params` mutate normally via `validate(schema, data)`.
- **Route param types must be a type alias, not an interface** (`type TaskIdParams =
  Record<'id', string>`). Express matches handler params against its `ParamsDictionary` index
  signature, and only aliases get an implicit index signature. An interface fails to typecheck
  at every `/:id` route.
- **`npm install <pkg>` needs `--legacy-peer-deps`.** `eslint-config-airbnb-extended` declares a
  peer of eslint 9 while the repo runs eslint 10. The ERESOLVE failure is pre-existing and has
  nothing to do with the package being added.
- **A reminder is owed when `notifiedAt` is null, not when the poller happens to be awake.**
  `EventPollingService` used to hold the window between passes in memory, so a restart meant
  anything that came due while the machine was down was never announced — not late, never. It
  stamps `notifiedAt` **before** sending, so a send slower than the poll interval cannot be
  started twice; the trade is that a failed send is not retried, which is right, because a
  duplicate alert is worse than a missed one. It also declines to announce an event whose window
  has already closed, so a machine down for a day does not wake up and read out yesterday.
- **The fly.io machine may not auto-stop.** Notifications come from a
  `setInterval` inside the process, not from an incoming request, so
  `min_machines_running = 1` / `auto_stop_machines = 'off'` in `fly.toml` are
  load-bearing. A stopped machine notices nothing, and because the poller's
  "already announced" window is in memory, a restart means those events are
  never announced at all — not even late.
- **`TaskType.REPEATED_DAILY` has the value `'DAILY'`** while its siblings are `'REPEATED_*'`.
  Known inconsistency; it is visible in API responses and the Postman collection.

## Frontend (GitHub Pages, iOS home screen)

Pages serves a *project* site from a subpath (`https://<user>.github.io/<repo>/`), which makes
these non-negotiable:

- **Relative paths everywhere** (`./`) — manifest `start_url`/`scope`, service worker
  registration, icons. An absolute `/…` breaks under a subpath.
- **Pass the registration to `getToken`.** Without
  `getToken({ vapidKey, serviceWorkerRegistration })` the SDK looks for
  `/firebase-messaging-sw.js` at the origin root, which does not exist on a project site.
- **Never call `showNotification` inside `onBackgroundMessage`** — Firebase already shows the
  notification, and you get duplicates.
- **iOS gives web push only to home-screen apps**: the user must Add to Home Screen, and
  permission must be requested from a user gesture inside the installed app.
- Pages and fly.io are different origins, so the API needs CORS for the Pages origin.
- Push lives in `frontend/notifications.js`, kept out of `app.js`. It contributes
  a token and nothing else — the server owns the schedule, so there is no task
  syncing on the client.

## Commands

```bash
npm test           # node:test via tsx, pinned to a non-UTC timezone
npm run dev        # tsx watch
npm run lint       # eslint .
npm run typecheck  # tsc --noEmit
npm run build      # tsc -p tsconfig.build.json
npm start          # node dist/server.js
```

`PORT`, `NODE_ENV`, `MONGO_URL` (default `mongodb://127.0.0.1:27017`), `MONGO_DB_NAME` (default
`tasks-api`) and `POLL_INTERVAL_MS` (default 60000) configure the app; `POLL_INTERVAL_MS` is what makes the event poller testable in seconds.

## Tests

`npm test` runs the built-in Node test runner over `test/**/*.test.ts` through tsx. No test
framework dependency.

- **Every date in a test is UTC**, built with the `utc()` helper in `test/support/time.ts`.
  Never `new Date('2026-08-22T10:00')` in a test — that parses as *local* time and the scenario
  silently shifts when the suite runs elsewhere.
- `utc('Sat 2026-08-22 10:00')` **asserts the weekday matches the date**, so a reader does not
  have to take "22 August is a Saturday" on trust, and a wrong date fails loudly.
- **The suite runs under `TZ=Asia/Kathmandu`** (UTC+05:45), set in the npm script. This is
  deliberate: a local-time bug in date handling *passes* under `TZ=UTC` and only shows up
  somewhere with an offset. A non-integer offset also catches half-hour errors.
- **Repository tests need a real Mongo** and skip themselves when none answers on `MONGO_URL`;
  each one runs against a throwaway database that is dropped afterwards. Every other test is pure.
- Task fixtures come from `test/support/tasks.ts` (`aDailyEvent`, `aWeeklyEvent`, …), so a test
  names only the date and active logic it cares about.
- Production date logic is UTC too: `startOfDay`, `endOfDay` and `endOfThisWeek` use
  `setUTCHours`/`getUTCDay`, never their local-time counterparts.

These are read from `.env` by dotenv. It is loaded at the top of `src/config.ts`, not in
`server.ts` — ESM evaluates an imported module before the body of the module importing it, so a
`loadEnv()` call anywhere else would run *after* `config.ts` had already read `process.env`. A
variable set in the real environment beats the file. `.env` is gitignored; `.env.example` is the
committed template, so add any new variable to both.
