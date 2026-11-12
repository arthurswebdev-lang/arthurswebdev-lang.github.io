# Should the assistant use RAG?

The question: *"What do you think about using RAG here? For example, generate a bunch of use
cases as text, embed them in a vector DB, connect them with proper tool usage with params and
examples, so they relate to the API needed to create them. Then find the proper ones, ask the
AI to find the best match, and continue."*

**Short answer: not now.** All our knowledge fits in the cached prompt about 100 times over, so
a vector database adds parts that can break and gives nothing back. But one part of the idea is
good and cheap: **worked examples of tool calls with real params**. We should take that part
and put it in the prompt. Details below.

This note builds on section 9 of `chat-assistant-feature.md` ("Do we need RAG?"). That section
was written when the domain was only the schema. Now we have 15 templates, so the question
deserves a second, longer look.

---

## 1. Words used in this note

- **Embedding** — a list of numbers (for example 1,024 numbers) that a special model makes
  from a piece of text. Texts with similar meaning get similar numbers.
- **Vector database / vector index** — a store that keeps embeddings and can answer "which
  stored texts are closest in meaning to this new text?".
- **RAG** (retrieval-augmented generation) — before each model call, search a store for the
  few pieces of text that look most related to the question, and put only those pieces into
  the prompt.
- **Few-shot example** — a finished example in the prompt that shows the model the exact
  answer shape we want ("for this request, call this tool with these params").
- **Prompt cache** — Anthropic keeps the start of our request (tools + system prompt) for
  5 minutes. If the next request starts with the same bytes, those tokens cost 20 times less
  and are processed faster.

---

## 2. What RAG would mean here

Your version, made concrete:

1. Write many use-case texts: "pay electricity and water on the 5th", "remind me to take
   vitamin D every morning", "my sister's birthday is 12 March", and so on — maybe 200–500.
2. For each one, store the matching tool call with full params, for example a
   `create_repeated_task` call with `kind`, `dayOfMonth`, `months`, windows and steps.
3. Turn each text into an embedding and store it in a vector index.
4. When the person writes the first message, embed that message too, find the 3–5 closest
   use cases, and put them (with their tool-call examples) into the prompt.
5. The model reads them, picks the best match and continues the chat.

This is a real and common pattern. The question is only whether our problem is big enough to
need it.

---

## 3. The size argument

### 3.1 What we have today (measured)

I rendered the real prompt and the real tool list from the code and counted characters.
Tokens are an **estimate** at about 4 characters per token. Emoji and JSON usually take a
little more tokens per character, so the true number may be 10–30% higher.

| Part | Characters | Tokens (estimate) |
| --- | ---: | ---: |
| Rules (`assistant.prompt.ts`, without templates) | 3,594 | ~900 |
| 15 templates, rendered (`renderTemplates()`) | 7,720 | ~1,930 (~130 each) |
| 6 tools, as JSON (`ASSISTANT_TOOLS`) | 8,091 | ~2,000 |
| **Cached prefix in total** | **19,405** | **~4,900** (say 5–6.5K) |

The minimum the cache accepts is 512 tokens, so we are well above it. The model's context is
1M tokens, so the whole prefix is about **0.5%** of it.

### 3.2 What it costs (Claude Opus 5.5)

Prices: input $4 / MTok, cache write about 1.25 × input = $5 / MTok, cache read $0.20 / MTok.

| Case | Cost of the ~5K prefix |
| --- | ---: |
| First request of a chat (cache write) | ~$0.025 |
| Each later request in the same chat (cache read) | ~$0.001 |
| A typical chat: ~8 requests (questions, plan, creates) | ~$0.032 |

One detail matters for this app: there is one person, and chats are rare. So the cache will
usually be **cold** when a chat starts, and the first request pays the write price. Inside a
chat the answers come within 5 minutes, so the rest are cheap reads. Even so, the prefix is a
few cents per chat. The model's own output and the growing chat history cost more than that.

### 3.3 When "put everything in the cached prompt" stops being good

If we add one few-shot example per template (section 5), each template grows to roughly
**280 tokens** (estimate: ~130 for the template, ~150 for the example).

| Templates | Prefix (estimate) | Cache read per request | Cache write per chat | Is "all in prompt" still good? |
| ---: | ---: | ---: | ---: | --- |
| 15 (today) | ~7K | $0.0014 | $0.035 | Yes, easily |
| 50 | ~17K | $0.0034 | $0.085 | Yes |
| 100 | ~31K | $0.006 | $0.16 | Yes, but watch quality |
| 300 | ~87K | $0.017 | $0.44 | Doubtful — move to an index + lookup |
| 1,000 | ~280K | $0.056 | $1.40 | No — retrieval is right |

Cost is not the main limit. **Quality is.** A model choosing between 15 clearly different
templates (birthday, bills, gym…) almost never picks wrong. With hundreds of templates, many
of them close to each other ("gym, 3 days", "gym, home workout", "gym, after injury"), two
problems appear:

- the model can mix the defaults of two similar templates;
- long prompts make it easier to miss a detail in the middle.

These limits are a judgement, not a measurement. My rough line: up to about 100 templates, keep
them all in the prompt. Between 100 and a few hundred, use the short index + `get_template`
tool from section 5. Beyond that, or when the text is not ours but the person's own growing
data, use retrieval.

We are at **15**. We are not close to any of these lines.

---

## 4. What RAG would add to the system

| New part | What it means for us |
| --- | --- |
| Embedding provider | Anthropic has **no embeddings endpoint**. The usual pairing is **Voyage AI** (now owned by MongoDB). That is a second API key, a second bill and a second service that can be down. |
| Vector index | Either **MongoDB Atlas Vector Search** (our data is already in Atlas, so no new database — check the limits of our cluster tier), or a separate vector DB (one more service to run). |
| An embedding call per chat | Only the first message really needs matching. Estimate: 100–300 ms for the embedding plus a fast search. Small next to an Opus turn of several seconds, but it is one more network hop that can fail. |
| Sync job | Every time a template or example changes, its embedding must be made again. If we forget, search uses the old meaning. Today "adding a template is adding one object" — that would no longer be true. |
| New failure mode | **Wrong retrieval.** If search returns gym templates for "pay my gym membership", the model never sees the subscription template. It cannot fix a mistake it cannot see. Today the model always sees all 15 and chooses itself. |
| Cache | Retrieved text changes per chat, so it must go **after** the cache breakpoint and is paid at full price. Not a big cost, but the opposite of today's design, where the prefix never changes. |
| Testing | We would need to test the search too ("does this sentence find this template?"), with a real embedding model, outside `npm test`. More moving parts in the eval. |

Also: the chips already solve most matching. Tapping "🎂 Birthday" starts the session on that
template, so there is nothing to search. Only free-typed first messages need matching at all,
and the model does that well when it can read every option.

---

## 5. The valuable part of the idea: examples with params

Your idea has two halves: (a) **search** and (b) **examples of tool calls with real params,
tied to the use case**. Part (b) is valuable even without search. Today a template says, in
words, "dayOfMonth and months [month]. Time 10:00. activeBefore 1440…". The model must turn
that into JSON. A worked example shows the exact shape, so mistakes like `months: [3]` vs.
`months: ["March"]`, or a missing `activeForMins`, become less likely. `propose_plan` already
returns Joi errors the model can fix, but each fix is one more round trip.

### Option A — one compact example per template, in the cached prompt (recommended)

Add an `example` to each `AssistantTemplate` and render it under the template. For example:

```
Example — "Anna's birthday is 12 March":
propose_plan {"items":[{"kind":"REPEATED_MONTHLY","name":"🎂 Anna's birthday",
 "category":"IMPORTANT","dayOfMonth":12,"months":[3],"times":["10:00"],
 "activeBeforeMins":1440,"remindBeforeMins":0,"activeForMins":1440}],
 "assumptions":["Reminder at 10:00 on the day"]}
```

That is about 300 characters, ~100–150 tokens (estimate). For 15 templates: about +2K tokens,
prefix ~7K. Cost: about +$0.0004 per request. Still frozen, still cached.

Rule: an example must pass the real Joi schemas. Add a unit test that runs each template's
example through the same validation `propose_plan` uses, so an example can never teach the
model a shape the server refuses.

### Option B — short index in the prompt + `get_template(id)` tool

The prompt holds only one line per template (`id — title — what it creates`, ~20 tokens each).
When the model has chosen, it calls `get_template("bills")` and gets the full questions,
defaults and examples as the tool result. This is "progressive disclosure": show a short list
first, load the details only when chosen.

It costs one extra round trip per chat, and the chosen template is paid at normal price (it
sits after the cache breakpoint). It only pays off when the full templates are too big for the
prompt — that is, at ~100+ templates. Not now. But it is the natural **next step** before RAG,
because the model still sees every option in the index and chooses itself.

### Comparison

| | A. Examples in cached prompt | B. Index + `get_template` | C. RAG (vector search) |
| --- | --- | --- | --- |
| Extra cost per chat | ~$0.003 (estimate) | ~1 extra request | Embedding call + uncached retrieved text |
| Extra latency | None | One extra model turn (seconds) | 100–300 ms + one more service |
| Accuracy of choosing | Model sees all options | Model sees all names | Model sees only what search returned |
| New code / services | One field + one test | One tool + handler | Embedding provider, index, sync job, search tests |
| What can go wrong | Example drifts from schema (the test catches it) | Model skips the call and guesses | Wrong match hides the right template; stale embeddings; extra outage |
| Good up to | ~100 templates | Several hundred | Thousands, or user data |

---

## 6. When RAG would be the right choice

RAG is right when the text to search is **large, growing, or not written by us**. For this
app, that would be:

- **Hundreds of templates written by people**, not 15 written by us — for example a shared
  library of community routines ("5×5 strength plan", "Ramadan schedule", "newborn feeding").
- **Searching the person's own history**: years of done tasks, notes and steps — "what was the
  stretching routine I did last spring?". That data grows forever and is different for every
  person, so it cannot live in a frozen prompt.
- **Long reference documents**: course syllabuses, medical leaflets, gym program PDFs that the
  person uploads and wants turned into steps.

Note that `find_tasks` / `find_repeats` already cover "look at my existing items" with exact
Mongo queries. That is the right tool while the list is small; it gives the same answer the
list screen gives.

If we get there, the first step would be:

1. **MongoDB Atlas Vector Search** on the collection we want to search — the data is already
   in Atlas, so no new database and no copy to keep in sync.
2. **Hybrid search**: keyword search (Atlas Search) together with vector search, results
   merged. Names like "leg press" or "Netflix" are matched best by plain words; meaning-based
   search helps with "the thing for my back". Hybrid gives both.
3. Expose it to the model as **a tool** (`search_history(query)`), not as automatic text added
   before every turn. Then the model decides when to search, and a bad result is visible to it
   and can be searched again.

---

## 7. Recommendation

1. **No vector database and no embeddings now.** ~5K tokens of knowledge does not need
   retrieval; the cache already makes it cheap, and the model choosing from all 15 templates
   is more reliable than a search choosing for it.
2. **Do take the "examples with params" part.** Add one compact, Joi-checked `propose_plan`
   example to each template, rendered into the frozen, cached prompt (Option A).
3. **Plan the next step, but do not build it:** when templates pass ~100, switch to a short
   index + `get_template(id)` (Option B).
4. **RAG only for data that grows** — the person's own history, or a shared community library —
   and then with Atlas Vector Search, hybrid with keyword search, behind a tool.

---

## 8. How we would know we were wrong

The plan already has an eval (phase 8): ~25 sample chats, each with a first message, the
answers, and the expected plan, run against the real API after every prompt change.

- Add a few **free-typed first messages that are close to two templates** ("pay for the gym",
  "call mum every Sunday and on her birthday"), so template choice is really tested.
- Record for each chat: which template the model followed, and how many `propose_plan`
  calls failed Joi before one passed.
- **Reconsider** if, after Option A is in, the eval shows template-matching mistakes more than
  once or twice in 25 chats, or if we are about to pass ~100 templates. Even then, try
  Option B first; it fixes size without hiding options from the model.
- If the eval shows **param** mistakes instead (wrong windows, wrong `months`), the answer is
  better examples, not search.
