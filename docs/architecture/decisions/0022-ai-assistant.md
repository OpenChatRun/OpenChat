# ADR-0022: An AI assistant that answers first, on Workers AI

**Status:** Proposed, 2026-11-19. The owner chose Workers AI, learning from past conversations, and off by default on Cloud, on 19 November 2026. The rest of this design needs the owner's acceptance before it is built.

## Context

The roadmap promises "an AI assistant that answers first": it replies to visitors from what a workspace gives it, hands over to a person when it cannot answer, is unsure, or is asked to, and runs in the installation's own Cloudflare account. Every message it writes is visible to the team, who take over from the same inbox.

The owner's choices:

- **Model.** Cloudflare Workers AI. No new provider: Cloudflare already hosts everything an installation holds, and Workers AI runs in the same account.
- **Sources.** Website pages and pasted text, **and past conversations**: what the team has already answered.
- **Cloud.** Off by default. A workspace admin turns it on.

What makes this harder than it looks:

- **Visitors' messages are untrusted input to a model.** Someone will try to make it say something the company never said, or reveal what it holds.
- **Internal notes must never reach a visitor** (AGENTS.md rule 4). A model given a conversation's notes could repeat them.
- **Past conversations hold personal data.** One visitor's address, order number or complaint must never appear in an answer to another.
- **Erasure and retention** ([data model](../data-model.md#contact-export-and-erasure)) must reach whatever the assistant learned from a conversation.
- **Transparency.** The EU AI Act (Article 50) requires that people be told when they are talking to an AI. Visitors must always see that a reply came from the assistant.
- **Cost.** Workers AI and Vectorize are billed to the account that runs them: the operator's own on a self-hosted installation, Orango Labs' on Cloud.

## Decision

### What it does

- A workspace admin turns the assistant on per website, gives it a name, and chooses its sources. It is off by default everywhere, not only on Cloud.
- When a visitor writes in a conversation that **no member is handling**, the assistant replies in the visitor's language, using only its sources.
- It **hands over** when any of these is true: no source is relevant enough, the model says it is unsure, the visitor asks for a person, or the conversation reaches a limit of assistant turns (default 5). Handing over posts a fixed message in the visitor's language ("I'm passing you to the team…"), marks the conversation for the team, and from then on the assistant stays silent in it.
- It also stops for good when a member replies, assigns the conversation, or adds a note.
- Members get push notifications only on handover, not for every message while the assistant is answering. The inbox shows the conversation with an "Assistant" label throughout, so anyone can step in.
- Every assistant reply is labelled as AI in the widget, the dashboard and the app.

### Sources and the knowledge store

- **Pages.** An admin gives URLs. The installation fetches them on the same site only, respects `robots.txt`, follows no more than a set number of links (default 50 pages), and refreshes them weekly or on demand.
- **Text.** An admin pastes text, such as opening hours or a returns policy.
- **Learned answers, from past conversations.** When a conversation is resolved, a job asks the model to turn the visitor's question and the team's public replies into one general question and answer, **with no personal data**. Raw messages never enter the knowledge store.
  - Only public messages are read. Internal notes are never read, by a type that cannot hold them, as for visitor-facing code.
  - A second check rejects any result that still holds an email address, phone number, URL with a query string, long number, or the contact's name or address.
  - **Each learned answer waits for an admin's approval before the assistant uses it.** An admin can turn approval off, per workspace, after seeing what it learns.
  - A learned answer keeps the ID of the conversation it came from. Erasing the contact, or retention expiring the conversation, deletes it, and its vector, in the same batch and outbox as the conversation's files.
- Every source is chunked, embedded with a multilingual model (`@cf/baai/bge-m3`), and stored in **Vectorize**, in **one namespace per workspace**. The chunk text lives in D1, in new workspace-scoped tables (`assistant_sources`, `assistant_chunks`), read only through a scoped repository (rule 1). Vectorize holds vectors, chunk IDs, and nothing readable.

### Answering

- The answer runs as a queued job, `assistant.reply`, on a new queue, `oc-assistant`, so slow model calls never hold up other jobs. The visitor's message is committed first, and the job is queued from the outbox (rule 3).
- **Idempotency.** The job claims `(conversation, the visitor message it answers)`. The reply is inserted with a `client_message_id` derived from that claim, so a retried job writes one reply ([Pattern 1](../data-model.md#pattern-1-idempotent-message-insert)). If a member replied, or the visitor wrote again, since the job was queued, it does nothing; the newer message has its own job.
- **What the model sees:** a fixed system prompt; the retrieved chunks, marked as quoted source material; and the conversation's last public messages. Nothing else: no internal notes, no contact attributes, no other conversation.
- **What the model can do:** write text. It has no tools, so a visitor who talks it round can make it say something wrong, but cannot make it act. Its reply is shown as plain text, never HTML. It may only link to URLs that appear in its sources.
- **The model** is a Workers AI text model chosen per installation from a short list, with a tested default. The list and the default are kept in one place, because Workers AI models are added and retired.
- While the job runs, the visitor sees "typing", as they do for a person.

### Data model

- Messages need to say an assistant wrote them. `messages.sender_type` gains `assistant`. SQLite cannot alter a CHECK constraint, so this means rebuilding `messages`, the largest table, as migration 0015 did for `push_subscriptions`. **Before this design is accepted, the rebuild is measured on a copy of the largest database we can produce, against D1's limits.** If it is too slow, the fallback is a new nullable column, `assistant_id`, on messages written as `system` by the assistant, which needs no rebuild.
- New tables: `assistant_settings` (per website), `assistant_sources`, `assistant_chunks`, `assistant_learned` (with `conversation_id` and approval state), and `assistant_usage` (per workspace per day).
- Contact export includes assistant replies, as it includes the team's.

### Limits and cost

- Per workspace: replies per day and pages per source set, with defaults an installation admin can change. Reaching a limit hands over, it never fails silently.
- On Cloud, each organisation also has a monthly allowance. Pricing is decided before Cloud charges for it. Until then it is free within the allowance.
- Usage is recorded in `assistant_usage` and Analytics Engine, so the cost per workspace can be seen.

### Installations

- New bindings: `AI` and a Vectorize index. An installation without them works as now, with the assistant hidden, as one without a relay has no push.
- `oc deploy` and the deploy button create the Vectorize index. Whether the button can is checked before this is built ([ADR-0020](0020-deploy-button-and-browser-setup.md)). If it cannot, setup in the browser explains the one command.

### Build order

1. **Sources and a test panel.** Pages and text, the knowledge store, and a panel in the dashboard where an admin asks questions and sees the answer and the sources it used. No visitor sees anything.
2. **Answering visitors**, with handover, labels, limits, and push on handover.
3. **Learned answers** from past conversations, with approval, erasure and retention.

Each step has its own exit check, as milestones do, and ships only when it passes.

## Consequences

- Visitors' messages, and the team's public replies, are processed by Workers AI in the installation's own Cloudflare account. Cloudflare says Workers AI does not use customers' data to train models. On Cloud, Cloudflare is already a subprocessor, but **the privacy policy, the Cloud DPA, and the records of processing must describe this new processing** before the assistant is offered on Cloud. That is a legal change, for the owner.
- A company that turns the assistant on should tell its visitors. The widget's label meets the AI Act's transparency duty; the company's own privacy notice is its business, and the user guide says so.
- The assistant will sometimes be wrong. It answers only from sources, hands over readily, and labels everything, but it cannot be made never to make mistakes. The user guide says this plainly.
- Prompt injection is contained, not prevented: the assistant has nothing to leak except its sources and the visible conversation, and nothing it can do except write.
- Learned answers can still carry personal data that the checks miss, such as a name written in an unusual way. Approval before use is the main defence, and is on by default.
- A new queue, a Vectorize index and a Workers AI binding are added to every installation's configuration, and to the [technology baseline](../overview.md#technology-baseline).
- `messages` is rebuilt once, or gains a column.

## Alternatives considered

- **The Claude API, or another commercial model.** Better answers, but a new provider holding visitors' messages, an API key for every installation, and, on Cloud, a new subprocessor with 30 days' notice. The owner chose Workers AI. The model is behind one interface, so a later ADR could add another.
- **Cloudflare AI Search (formerly AutoRAG)**, which crawls, chunks and indexes by itself. Less to build, but it keeps an index per instance, not per workspace, and puts crawled content in R2 outside the workspace's scoped tables, which makes erasure and tenancy harder to show. Revisit when it supports per-tenant isolation.
- **Indexing past conversations as they are.** Simplest, and the most useful, but an answer could quote another visitor's personal data. Rejected.
- **Running the model in the Durable Object, or in the request.** Faster first reply, but a model call can take seconds, and rule 5 forbids holding up a Durable Object. A queue also gives retries and a dead-letter queue for free.
- **An assistant member account**, so that its messages are `member` messages and no rebuild is needed. It would count in first-response times, appear in member lists, and need a session it should never have. Rejected.
