# Data model and D1 design

The schema is [`packages/database/src/schema/index.ts`](../../packages/database/src/schema/index.ts), and the generated migrations sit beside it. The tests under [Verification](#verification) run in workerd against those migrations, and spike S4 repeated the key ones on real D1 ([results](cloudflare-validation.md#phase-0-spike-results)).

## Principles

- **D1 is the source of truth.** Durable Objects, queues, and the relay hold nothing that cannot be rebuilt.
- **One database per installation for the MVP.** Static bindings make per-tenant databases awkward, and the 1,000 queries/s ballpark is enough for early installations.
- **Tenant boundaries are enforced by the schema**, not just by application code.

## Identifiers and time

| Item | Decision | Reason |
|---|---|---|
| IDs | `<prefix>_<26 chars>`: Crockford base32 of a UUIDv7, for example `conv_01JCQ...` | Time-sorted primary keys keep B-tree writes local. The prefix makes logs readable and catches mistakes. Generated in `packages/shared`, because `randomUUIDv7` is unavailable in Workers. |
| Tenant identifier in a record | `workspace_id` on every workspace-owned table | Spec requirement |
| Timestamps | INTEGER milliseconds UTC in the database, RFC 3339 in the API | Compact and sortable |
| Clock for cursors | Columns used as sync cursors take their time from the database in SQL | Worker clocks at different edge locations can disagree, and a cursor based on them can skip rows. Sync also overlaps its cursor by 5 seconds. Confirm SQL function support on D1 in S4. |

## Schema notes

Beyond the spec's entities, the schema adds what stated requirements need:

| Addition | Requirement it serves |
|---|---|
| `installation` | Which relay has accepted it, and which one an admin disconnected from (`relay_disconnected_id`, which turns push off while that relay is configured), public URL. `signup_policy` is no longer read ([ADR-0016](decisions/0016-installation-admin-replaces-workspace-managers.md)) |
| `auth_sessions`, `auth_tokens` | Sessions, refresh tokens, reset, verification. `invitations` is unused, and stays until a later migration removes it |
| `visitors` | Multiple devices per contact; contact merge |
| `messages.seq`, `public_seq`, `visibility`, `client_message_id` | Ordering, note isolation, idempotency |
| `conversation_read_cursors` | Delivered and read status without one row per message and reader |
| `conversations.version`, `last_mutation_id` | Optimistic concurrency without interactive transactions |
| `auth_tokens.consumed_by` | The same guard for one-time tokens: later statements in a reset batch apply only to the attempt that spent the token |
| `conversations.next_automation_at` | Inactivity detection without table scans |
| `tags`, `conversation_tags`, `contact_tags` | Tagging |
| `push_subscriptions` | Replaces `Devices`. Holds handles, never APNs tokens, and `preview_key`, the phone's public key that each notification is encrypted to ([ADR-0017](decisions/0017-encrypted-notifications.md)). Migration `0010` deleted rows without one. Migration `0011` dropped `workspaces.relay_display_name`, because the relay holds no workspace names |
| `email_suppressions`, `email_deliveries` | Suppression and duplicate prevention |
| `email_unsubscribe_links` | One row per link sent, with a hash of its token. [Contact erasure](#contact-export-and-erasure) removes a contact's links |
| `contacts.follow_up_consent_*` | Consent evidence |
| `automation_runs` | At most one follow-up per rule and quiet period |
| `outbox`, `job_receipts`, `failed_jobs` | Reliable dispatch, consumer idempotency, durable failure records |
| `audit_log` | §18 |

### Tables without `workspace_id`

`installation`, `users`, `auth_sessions`, `auth_tokens`, `workspaces`, `job_receipts`, `failed_jobs`. This list is the allowlist for the CI check that every other table has the column. `outbox`, `audit_log`, and others do carry it.

Users are global to an installation, because one person can be a member of several workspaces.

Neither users nor members are deleted, because messages find their author through them. `users.disabled_at` marks a deactivated account and `workspace_members.removed_at` a removed member, whose `status` is also `suspended` so that every access check refuses them. Both can be undone ([ADR-0015](decisions/0015-installation-admin-and-reversible-removal.md)).

## Write patterns

D1 has no interactive transactions. A `batch()` commits atomically, but JavaScript cannot act between its statements. Therefore **all conditions must be expressed in SQL**, and a statement must be able to tell whether an earlier one in the batch took effect.

### Pattern 1: idempotent message insert

```sql
-- batch([...]) with $mid a freshly generated message ID
INSERT INTO messages (id, workspace_id, conversation_id, seq, public_seq, client_message_id, visibility, ...)
  SELECT $mid, c.workspace_id, c.id, c.last_message_seq + 1,
         CASE WHEN $vis = 'public' THEN c.last_public_seq + 1 END, $clientId, $vis, ...
  FROM conversations c WHERE c.workspace_id = $w AND c.id = $c
  ON CONFLICT (workspace_id, conversation_id, client_message_id) DO NOTHING;

UPDATE conversations
   SET last_message_seq = last_message_seq + 1,
       last_public_seq = last_public_seq + CASE WHEN $vis = 'public' THEN 1 ELSE 0 END,
       last_message_at = $now, version = version + 1, updated_at = $now
 WHERE workspace_id = $w AND id = $c
   AND EXISTS (SELECT 1 FROM messages m WHERE m.id = $mid);

INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
  SELECT $oid, m.workspace_id, 'message.created', m.id, $payload, $now
  FROM messages m WHERE m.id = $mid;
```

- The freshly generated `$mid` exists only if the insert took effect, which guards the two later statements.
- A replay of the same `clientMessageId` changes nothing. `meta.changes = 0` on the first statement tells the handler to read and return the original message with 200, not 201.
- A wrong workspace or conversation also changes nothing, so the handler returns 404.
- Because D1 executes one batch at a time, `seq` cannot collide. The unique index is a second safeguard.
- **Two sequences.** Agents use `seq`, covering everything. Visitors see `public_seq` under the name `seq`. Internal notes do not consume it, because gaps would let a visitor count private notes and would break gap detection in the widget.

A visitor's first message also creates the conversation, in the same batch. The conversation's ID is derived from the visitor and the `clientMessageId`, so a retry reaches the same row and becomes a replay. Those IDs are not time-sorted, which matters less here than a retry never creating a second conversation.

### Pattern 2: compare-and-set with a follow-up statement

```sql
UPDATE conversations
   SET assigned_member_id = $m, version = version + 1, last_mutation_id = $mutation, updated_at = $now
 WHERE workspace_id = $w AND id = $c AND version = $expected;

INSERT INTO conversation_events (id, workspace_id, conversation_id, event_type, ...)
  SELECT $eid, workspace_id, id, 'assigned', ...
  FROM conversations WHERE workspace_id = $w AND id = $c AND last_mutation_id = $mutation;
```

If the update changed no rows, the API returns 409 with the current version.

> **Do not guard follow-up statements with `version = $expected + 1`.** A prototype did this and failed: when a concurrent writer has already advanced the version, the stale request's update correctly does nothing, but its follow-up still matches and writes a false audit event. `last_mutation_id` is unique to the request, so it can only match the request's own update. `changes()` might also work, but its behaviour across D1 batch statements is not documented, so it is not used.

### Pattern 2a: the audit row as the guard

For a table with no `last_mutation_id`, such as `workspace_members`, the first statement inserts an audit row with `INSERT ... SELECT ... WHERE <the rule>`, using a fresh ID. Later statements check that this row exists. The action and its audit record therefore cannot disagree, and a refused action leaves no trace. `consumed_by` on `auth_tokens` does the same job for one-time tokens.

### Pattern 3: reads that inform a write

Authorisation reads happen before the batch, and that is acceptable because the batch re-checks tenancy in its own SQL. A membership revoked in the gap between the two allows at most one further write. Where that matters, such as last-owner protection, the rule goes in the statement's `WHERE` clause.

## Contact export and erasure

For a person's request to see, or delete, what a workspace holds about them. Both need an installation admin who is an active member of the workspace ([ADR-0016](decisions/0016-installation-admin-replaces-workspace-managers.md): managing does not include reading). Any other member gets 403, and anyone else 404.

**Export** (`GET …/contacts/{id}/export`) reads in one batch, so it is one consistent view: the contact, including attributes and follow-up consent; their tags; their browsers (`visitors`); their conversations with every message; each file's name, type, and size, not its content; and the email suppression for their address. A message says only whether a visitor, a colleague, or the system wrote it, never which colleague. Internal notes are left out unless `include=notes`, because the export is usually handed to the person it is about. Reading changes nothing and is not audited.

**Erasure** (`DELETE …/contacts/{id}`) is one batch in [Pattern 2a](#pattern-2a-the-audit-row-as-the-guard). The audit row `contact.erased` holds IDs only. Every statement after it depends on that row:

| Removed | How |
|---|---|
| The contact, their browsers, conversations, messages, read positions, events, contact and conversation tags, and automation runs | Deleting the contact, by cascade |
| File rows | Deleted first, because a file also refers to its message, without a cascade |
| Files in R2 | An outbox row, `contact.erased`, lists the conversation IDs. Dispatch deletes everything under `w/<workspace>/c/<conversation>/`, including files never sent, and the sweep retries until it is done |
| `email_unsubscribe_links` | By the contact's address, both as read before the batch and as stored at commit |
| `email_deliveries` | By the hash of the address, as the delivery log stores it |
| `failed_jobs` | Rows whose envelope names one of the conversations |
| Another contact's `merged_into_contact_id` pointing here | Set to NULL. Merging is not built, so none exist yet |

**Kept, on purpose:** the `email_suppressions` row, so that an address that opted out stays out if it comes back as a new contact. The outbox rows of earlier events, which hold IDs only, and are purged on their usual schedule.

**Not reached:** a push job already queued holds a notification's text for at most an hour, when it expires. The relay holds nothing about contacts. Copies in D1 Time Travel last 30 days. Erasure does not close a visitor's open socket. Nothing more is published to it, because the conversation is gone, and it cannot get a new ticket, because the visitor's token is gone too.

## The AI assistant

[ADR-0022](decisions/0022-ai-assistant.md), steps 1 to 3. Five tables, each with `workspace_id`, reached only through `assistantRepository`:

| Table | Holds |
|---|---|
| `assistant_settings` | One row per website: the name visitors will see, a model, or NULL for the installation's default, `enabled`, whether it answers visitors, and `learn`, whether it learns from resolved conversations |
| `assistant_sources` | What the assistant answers from: a web page (`kind='page'`, with `url`) or pasted text (`kind='text'`, with `content`). `status` is `pending`, `indexing`, `ready` or `failed`, with `error_code`. `generation` goes up each time the source changes or is read again; `indexed_generation` is the one the chunks are from |
| `assistant_chunks` | Passages of a source, about 1,200 characters each. The ID is `<sourceId>.<generation>.<n>`, and is also the vector's ID in Vectorize |
| `assistant_usage` | Per workspace and UTC day: answers, pages read, and passages written. Answers are counted with `INSERT … ON CONFLICT DO UPDATE … WHERE answers < limit RETURNING`, so the daily limit holds without a read first |

**Generations guard the writes.** Indexing runs in a queue job, outside any transaction. Each statement that ends it (deleting old chunks, inserting new ones, marking the source ready) has `WHERE generation = ?` for the generation the job read. A job for a source that has since changed, or been deleted, writes nothing, and removes the vectors it wrote.

**Vectors live outside D1.** Vectorize has one namespace per workspace, and a metadata index on `websiteId`, so a query sees only one website. Removing a source, or replacing a generation, writes an outbox row, `assistant.vectors_removed`, listing the vector IDs, in the same batch as the D1 change. Dispatch deletes them, and the sweep retries until it is done. On real Vectorize, deletes and upserts took 30 to 60 seconds to show in queries ([validation](cloudflare-validation.md#ai-assistant-sources-on-real-cloudflare-2026-11-19)).

**Answering visitors (step 2).** Two columns, added by migration 0017 with hand-written CHECKs:

- `messages.assistant_id` names the `assistant_settings` row that wrote a message. Such a message has `sender_type = 'system'` (`messages_assistant_ck`), visibility `public`, `metadata_json.assistant` of `answer` or `handover`, and for a handover `metadata_json.reason`: `asked`, `no_sources`, `unsure`, `turns`, `limit` or `error`. Its sender name is the assistant's current name.
- `conversations.assistant_state`: NULL (never answered), `answering`, `handed_over` or `stopped` (`conversations_assistant_state_ck`).

| From | To | When |
|---|---|---|
| NULL or `answering` | `answering` | The assistant answers |
| NULL or `answering` | `handed_over` | The assistant hands over |
| NULL or `answering` | `stopped` | A member replies, writes a note, or the conversation is assigned to someone |

`handed_over` and `stopped` are final. An assistant message is a Pattern 1 insert, with `client_message_id = 'assistant:<visitorMessageId>'`, so a retried job writes it once. Its `INSERT … SELECT` also requires, at commit, that the visitor's message is still the conversation's last, that nobody has the conversation, that the state is NULL or `answering`, and that the website's assistant is still enabled. If anything changed while the model was thinking, nothing is written.

**Learned answers (step 3).** `assistant_learned` holds one row per conversation (`assistant_learned_conversation_uq`): a `question` and `answer` the model wrote from it, never its messages, with a `status`: `pending`, `approved`, `rejected`, or `discarded` when nothing could be learned, with `discard_reason`. `learned_seq` is the conversation's last message when it was read, so it is read again only after new messages, and never over a supervisor's decision. Only `approved` rows are used. `workspaces.assistant_auto_approve` saves new ones as approved; a change is audited as `assistant.auto_approve_changed`.

**Unanswered questions** are not stored: they are read from the assistant's handover messages, which already carry `assistant_id`, the reason in `metadata_json` (`no_sources` or `unsure` are the ones listed), and the visitor's message they answered in `client_message_id` (`assistant:<message id>`). The partial index `messages_assistant_idx` on `(workspace_id, created_at)`, over the assistant's messages only, serves the list. `assistant_question_reviews` holds a supervisor's decision about one, `answered` or `dismissed`, keyed by the handover message and deleted with it, so erasure and retention need nothing more. An answer is written as the conversation's `assistant_learned` row, approved, in one batch with the review and the outbox row that indexes it, and only if the conversation has no learned answer that was not discarded (409 `learned_exists` otherwise). The learning job never writes over an approved row, so resolving the conversation later leaves the supervisor's answer alone.

A learned answer is a one-passage source: its vector's ID is `<id>.<indexed_generation>.0`, so `assistant.vectors_removed` deletes it as it deletes a source's. Approving, editing or rejecting bumps `generation`, clears `indexed_generation`, and writes the outbox rows to remove the old vector and, if approved, index the new one, in one batch. Retrieval reads it only while it is approved and at the indexed generation, so a stale vector finds nothing.

Its foreign key to the conversation cascades. Erasure and the retention sweep add, in their batches and before the conversations go, one `assistant.vectors_removed` row for each learned answer with a vector; the row ID is fixed by the answer and generation, so a repeat writes nothing.

**Erasure.** Assistant messages are messages: contact export includes them, and erasure deletes them with the conversation. Learned answers go with their conversation, as above. They hold no personal data by design, so contact export leaves them out. Sources are the company's own pages and texts, not visitor data, so contact export and erasure do not touch them. Websites and workspaces cannot be deleted yet. When they can, their vectors must be removed by ID from `assistant_chunks` first, because Vectorize cannot delete a namespace.

## The help centre

[ADR-0023](decisions/0023-help-centre.md), step 1. Three tables, each with `workspace_id`, reached by members only through `helpRepository`, and by visitors only through `publicHelpRepository`, which reads `published` articles of the website a slug names:

| Table | What it holds |
|---|---|
| `help_collections` | Groups of articles in one language, with a slug unique per website and language |
| `help_articles` | `body_markdown` as written; `body_html`, rendered from it on save from an allow-list, which is all a visitor is sent; `search_title` and `search_text`, normalised for search; `status` `draft` or `published`, with `published_at` set only when published (`help_articles_published_ck`); `version`, for compare-and-set edits; and `translation_group_id`, shared by the same article in other languages |
| `help_assets` | Images, PNG, JPEG, GIF or WebP, whose files are in the attachments bucket at `help/<id>` |

`websites` gains `help_slug` (the public address, unique where set), `help_version` and `help_noindex`. Every change a visitor could see bumps `help_version` in the same batch as the change, and public pages are cached under the website's ID and that version, so nothing stale is served. Versions only grow, and the key carries the website because an address can pass to another website.

**Search** reads no FTS5 table, because `wrangler d1 export` refuses databases with virtual tables. `search_text` is the title, U+0001, the summary, U+0002, and the body as plain text, each lower-cased with accents folded from Latin, Greek and Cyrillic letters. A query becomes words, or overlapping pairs of characters in Chinese, Japanese and Korean, at most 12; every one must appear (`instr`), and results rank by matches in the title, then the summary, then the body. It scans one website's published articles in one language, so a website has at most 1,000 articles of 20,000 characters.

**Inbox search** has no FTS5 table either, and no column of its own. `GET /conversations?q=` reads the workspace's conversations, sorts them newest first, as it did when it looked at contacts only, and keeps one if the contact's name or email contains the words, or if any of its messages does: `instr(lower(content), q)` over that conversation's rows of `messages_seq_uq`, stopping at the first. For the rows of the page only, a second subquery finds the newest matching message and cuts 140 characters around the words, returned as `searchMatch`. `lower()` changes A to Z only, so a position in it is a position in the text. The cost is the messages read before the page fills: all of a workspace's messages for words nobody wrote.

A collection is deleted in one batch that first takes its articles out of it: a composite foreign key cannot `SET NULL`. Websites cascade to all three tables. An image's row is deleted before its file, so a failure leaves a file that nothing points to, never a broken row.

**The widget's Help tab** (step 3) adds `conversations.help_article_id`, nullable and without a foreign key, so that deleting an article does not touch conversations: the inbox then says the article was deleted. It is set only on insert, from a subquery that finds a published article of the conversation's website, so a visitor cannot attach another website's ID. Migration 0021 only adds the column.

**The assistant** (step 4) reads published articles as learned answers are read, without an `assistant_sources` row:
- **`help_article_chunks`** holds an article's text in pieces, deleted by cascade with the article.
- **`help_articles` gains** `indexed_version` and `indexed_chunks`, which name its vectors `<article>.<version>.<n>`, so that `assistant.vectors_removed` deletes them as it does a source's.
- **Retrieval** joins the chunks only while the article is published, and builds the link to its page when it reads them, from the website's current help address, so that a new address is never stale. With no address, the chunk has no link.
- **Migration 0022** only adds the table and the columns.

**Draft with AI** (step 2) adds `help_draft_runs`: one per run.
- **What it keeps:** the language, an optional collection, whether to read the website, the links, and the names and sizes of the files. The files themselves are never in it.
- **`status`:** `uploading` (taking files), `queued`, `reading`, `writing`, `done` or `failed`, with an `error_code` when it failed.
- **Outline and counts:** the outline as JSON, `planned`, and `failed_json`, the outline positions that could not be written.

While a run is open, its files and material are in the attachments bucket under `help-draft/<runId>/`. They are deleted when the run ends, or by the hourly sweep. Starting a run writes the `help.draft_started` outbox row in the same batch.

Articles gain four columns:
- `draft_run_id` and `draft_index`, unique together where set, so that a repeated job writes nothing twice;
- `ai_drafted`, which any change to the title, summary or body clears;
- `ai_sources_json`, the pages and files the article came from.

Runs have no foreign key from articles, and a collection a run names is checked when each article is written.

**Limits.** Runs go through one guarded insert. It requires the website to exist and to have no open run, and the workspace to have started fewer runs today (UTC) than `LIMIT_HELP_DRAFT_RUNS_PER_WORKSPACE_PER_DAY`, 5 by default. The ADR said drafting would be counted with the assistant's answers. It has a limit of its own instead, so that drafting never uses up the answers visitors get.

**Audit.** `help.address_changed` (with `from` and `to`), `help.article_published`, `help.article_unpublished` and `help.article_deleted` (with the title and language). Writing and editing are not audited: they change nothing visitors see until publishing does.

**Privacy.** Articles and images are the company's content, not visitor data. Contact export, erasure and retention do not touch them.

## Languages

Automatic translation ([ADR-0024](decisions/0024-automatic-translation.md)) needs to know who reads what. Step 1 stores it; nothing is translated yet.

- **Analytics** store nothing. `GET …/analytics` counts from `conversations` and `messages` on each request: the conversations a workspace started in the period, found through `conversations_created_idx` (migration 0029), and for each its first public message from a member, looked up by conversation. At most 10,000 conversations are read.
- **`saved_replies`**: a workspace's saved replies, each a title, unique in the workspace whatever its case, and the text it puts in the reply box. At most 200, checked in the `INSERT` itself. Every member reads them; `savedReply.manage`, for supervisors, writes them. Nothing about a visitor is in them unless a member types it.
- **`conversations.visitor_rating`**, **`visitor_rating_comment`** and **`visitor_rated_at`** (migration 0030): what the visitor said of the conversation, `good` or `bad`, with a comment of at most 500 characters. One statement checks that the conversation is the visitor's, that it is resolved, and that its website has not set `askForRating` to false; otherwise the answer is 409 `rating_not_open`. It replaces any earlier rating, and leaves `version` and `updated_at` alone, like a page view, so no client has to merge it. It goes with the conversation in an export, erasure and retention.
- **`conversations.visitor_page_url`** and **`visitor_page_at`**: the page the visitor's widget last reported, as origin and path, with no query or fragment, at most 500 characters. One statement checks that the conversation is the visitor's and that the page's origin is one the website allows. It replaces the last page, and leaves `version` and `updated_at` alone, so a page view is not a change that clients sync. The Worker variable `VISITOR_PAGE=off` makes the route keep nothing and the bootstrap tell widgets not to send.
- **`conversations.visitor_language`**, a BCP 47 tag in its usual spelling (`pt-BR`, `zh-Hant`). The widget sends it with the first message and with every later one, and the message's own conversation update keeps it with `COALESCE(visitor_language, ?)`, so the first one sent stays. Conversations from before it was recorded get it from the visitor's next message. A tag that is not well formed is dropped, never refused, so a message is never lost over its language. A supervisor's correction, through the conversation update, is recorded as a `language_changed` event.
- **`users.language`**, one of OpenChat's eleven languages. It belongs to the person, not the membership: someone reads the same language in every workspace. `PATCH /api/v1/me` writes it.

The ADR has the widget send the language when it creates a session as well. A session has nowhere to keep it, so the widget sends it with messages instead, which also fills in conversations that began before.

Migration 0023 only adds the two columns.

**Translations** (step 2) are in `message_translations`, one row per message and language, keyed `(workspace_id, message_id, language)`, with the model that wrote it. Its foreign key to `messages` cascades, so erasure and retention delete translations with their messages; nothing else needs to know about them. A translation is inserted from a `SELECT` on its message, so one for a message deleted meanwhile is never stored, and the first one stored for a language is kept (`ON CONFLICT DO NOTHING`). Members' message lists carry them; visitors' never do. Contact export includes them as `machineTranslations`.

**A member's reply sent translated** (step 3) stores what the visitor received as `messages.content`, the member's own words as a `message_translations` row in their language (model `original`), and that language in `messages.original_language`. Both are written in the message's batch, the row only if the message was inserted, so a replay adds nothing. Member and visitor queries read the original beside the message; it is not listed among the machine translations. Migration 0025 adds the column.

The workspace's choice is `workspaces.translation_enabled` and `translation_model` (NULL for the default, `m2m100`). Characters translated are counted in `assistant_usage.translated_chars`, taken before the model is called by an upsert that refuses to pass the day's limit. Migration 0024 adds the table and the columns.

## Retention

Each workspace has `retention_days`, set by an installation admin under **Workspaces** (`PUT /api/v1/admin/workspaces/{id}/retention`), from 30 days to ten years. NULL, the default, keeps everything. A change is audited as `workspace.retention_changed`, with the old and new values.

An hourly sweep, in `services/api/src/retention.ts`, then deletes for each workspace with a setting:

| Removed | When |
|---|---|
| Conversations, with their messages, events, tags, read positions, automation runs, files, and `failed_jobs` naming them | Resolved or archived, and the last message is older than the setting. Open and pending conversations are kept, however old |
| Contacts, with their browsers and tags | No conversations left, and not seen within the setting |
| `email_unsubscribe_links` | Created before the cutoff, for an address no contact in the workspace still has |
| `email_deliveries` | Created before the cutoff |

Conversations go as erasure does them: one batch writes an outbox row, `conversations.expired`, whose ID list fixes which conversations go, an audit row with the count, and the deletions. Dispatch then deletes their files from R2. A conversation that gets a new message before the batch no longer qualifies and stays. Every statement repeats the check that the setting is still what the sweep read. Contacts that go are counted in a `contacts.expired` audit row. Merge pointers to them are cleared first.

**Kept, on purpose:** `email_suppressions`, as for erasure, and the audit log, which holds IDs only.

Whatever the setting, every installation also deletes, hourly:

| Removed | When |
|---|---|
| `auth_sessions`, `auth_tokens` | Expired |
| `job_receipts` | Claimed more than 14 days ago, past the longest a queue keeps a message |
| `failed_jobs` | Failed more than 90 days ago |
| Contacts with no address and no conversations, with their browsers | Not seen for 30 days: visitors who opened the widget but never wrote |

**Rate.** Each run takes at most 500 conversations from each of 200 workspaces, in chunks of 50, and 500 rows of each other kind, so turning retention on for a large backlog takes hours, not one long write that holds up live traffic. D1 Time Travel keeps copies for 30 days.

## Concurrency and capacity rules

| Rule | Reason |
|---|---|
| Hot path is one batch per message | Round trips cost more than statements |
| Target under 5 ms per query, alert above 20 ms at p95 | One query at a time means slow queries delay every tenant |
| Keyset pagination only, no `OFFSET` | `OFFSET` scans |
| No unbounded `UPDATE` or `DELETE`; chunk with `WHERE id IN (SELECT id ... LIMIT 500)` and continue in a queue job | Long statements block everything. This includes **workspace deletion**: cascades over a large tenant must be chunked, even though the schema supports a single cascade |
| At most 100 bound parameters; chunk `IN` lists | Limit |
| Message content capped at 16 KB, JSON columns at 16 KB | Well under the 2 MB row limit |
| Retry only on transient errors, and only for idempotent statements, at most twice with jitter | Retrying under overload makes it worse. Surface 503 with `Retry-After` |
| `next_automation_at`, `outbox` scans use partial indexes | Keeps sweeps cheap as tables grow |
| Every foreign key has an index that starts with its columns, checked by `pnpm check:migrations` | SQLite looks up child rows on every parent delete and cascade. Without the index, each deleted conversation, tag or website scans the whole child table |

### Read replication

Off for the MVP. Queries go through a `DatabaseProvider` so that `withSession()` and bookmarks can be added later. When enabled, read-your-writes requires a bookmark to travel with the client, which the API could return in a header.

### Reaching the 10 GB limit

1. `/health/database` reports the size to operators, and warns at 70% ([monitoring](../operations/monitoring.md)).
2. After MVP, archive old conversations to R2 as NDJSON and delete in chunks. Meanwhile a workspace can set [retention](#retention), which deletes closed conversations once they are old enough.
3. Move message bodies to a second D1 database if necessary. The repository layer hides this, though `batch()` cannot span two databases, so that move needs a redesign of Pattern 1. Treat it as a major change, not a tuning step.

## Migration strategy

**Pipeline**

1. Edit the Drizzle schema in `packages/database/src/schema`.
2. `pnpm db:generate` writes SQL to `packages/database/migrations`. Reviewed and committed like code. CI fails if the schema and migrations disagree.
3. Apply with `wrangler d1 migrations apply`, set up with `migrations_dir`. Drizzle's flat output needs no `migrations_pattern`.

S8 confirmed this pipeline on local and real D1. Drizzle expresses partial indexes, descending index columns (through `sql` fragments), and `COLLATE NOCASE` (through a custom type), so no hand-written migrations are needed so far. It cannot express `WITHOUT ROWID`, so the tables that used it in the draft are ordinary rowid tables. That costs a little space and lookup speed on small association tables and changes no behaviour. If it ever matters, a custom migration can rebuild those tables.

**Compatibility rules**

A migration and a Worker deploy are not atomic, and rollback restores code but not schema. So every migration must work with both the previous and next Worker versions:

| Change | How |
|---|---|
| Add column | Nullable or with a default. Backfill through a job. Then begin using it. |
| Remove column | Stop reading, deploy; stop writing, deploy; drop in a later release. |
| Rename | Add new, write both, backfill, switch reads, drop old. Never rename directly. |
| Table rebuild | Avoid. If unavoidable, use `PRAGMA defer_foreign_keys = on`, and never `PRAGMA foreign_keys = off`, since D1 does not allow changing it. Beware that `DROP TABLE` runs an implicit delete with cascades; test on a copy. |
| Large backfill | A chunked queue job, never a migration, because a query is limited to 30 seconds and blocks other work. |

**Self-hosted upgrades.** Customers may skip versions, so migrations always run in order and contract steps are never squashed into the expand release. The compatibility window is documented per release.

**Safety.** The deploy CLI records `wrangler d1 time-travel info` output before applying migrations, and prints the restore command. Restores discard messages written since that point, so they are a last resort. Prefer forward fixes. `oc backup` and `oc restore` are in [backup and restore](../operations/backup-and-restore.md).

**Failure behaviour.** Cloudflare's documentation does not state whether a failed migration file rolls back, so S4 tests this. Until confirmed, migrations are single-purpose and small.

## Verification

Run on Node's SQLite with `PRAGMA foreign_keys = ON` on 2026-11-03. These establish that the SQL is correct. They do not show D1 behaviour or performance.

| Scenario | Result |
|---|---|
| Send two messages | `seq` 1 and 2, conversation counter 2, two outbox rows |
| Public, internal note, public | `seq` 1, 2, 3 and `public_seq` 1, NULL, 2, with no gap visible to the visitor |
| Replay a `clientMessageId` | Zero changes in all three statements |
| Send with the wrong workspace | Zero changes in all three statements |
| Reference another tenant's parent (messages, contacts) | Blocked by the foreign key |
| Internal note marked public; public message marked internal; visitor-authored note | Blocked by `CHECK` |
| Stale compare-and-set | Zero rows updated, and no event written |
| Delete a conversation; delete a workspace | Cascades complete and leave other tenants intact |
| Inbox, assignee, history, public history, sync, automation, and outbox query plans | Index search, no temp B-tree, no scan |
| All 29 tables | Every table outside the allowlist has `workspace_id` |

In addition, `toVisitorEvent` from the [draft contract](../api/realtime-protocol.draft.ts) was run directly. Notes and assignment changes map to nothing, and output contains no member IDs, metadata, or `visibility`. Sequence and read positions use `public_seq` values only.
