# Security architecture

The relay's protocol and threat model are in [notification-relay/protocol.md](../notification-relay/protocol.md).

## Tenant isolation

Five independent layers, on the assumption that any one can fail. See [ADR-0004](decisions/0004-tenant-isolation.md).

| Layer | Mechanism | Catches |
|---|---|---|
| 1. Types | `WorkspaceContext` is a branded type that only the authorisation middleware can create | Forgetting to authorise |
| 2. Repositories | `repositories(ctx)` applies `workspace_id` to every query. The raw handle is private to `packages/database`. System jobs use a separate `systemRepositories` whose calls are searchable and reviewed | Forgetting the filter |
| 3. Schema | Composite foreign keys on `(workspace_id, id)`. **Tested:** a cross-tenant reference fails at the database | Bugs in layers 1 and 2 on writes |
| 4. Isolation test suite | For every route in OpenAPI, a test calls it with a valid token for workspace B against resources in workspace A and expects 404. **A new route with no case fails CI.** The suite also fails on a served route missing from the contract. It compares workspace A's rows before and after each refused request, and checks that the workspace's own owner succeeds, so a route that always answered 404 would not pass. See `services/api/test/isolation.test.ts` | Bugs on reads and writes |
| 5. Other stores | R2 keys are prefixed `w/<workspaceId>/`, and access first checks the attachment row. Durable Object names derive from verified IDs only | Non-SQL leakage |

Every request verifies, in order: identity, membership, permission, resource ownership (spec §9). Cross-tenant requests return **404**, so resource existence does not leak.

## Agent authentication

| Item | Decision |
|---|---|
| Password hash | scrypt with N=2^15, r=8, p=3 (32 MiB), one of OWASP's listed configurations. N=2^17 needs 128 MiB, which is the entire isolate limit. Parameters stored per hash for later upgrades. Timing confirmed in S3. |
| Access token | JWT, EdDSA signed, 15-minute lifetime. Claims: `sub`, `sid`, `iss = installationId`. **No roles in the token**; membership is read per request so that revocation is immediate. |
| Refresh token | Opaque, 256-bit, stored as SHA-256. Rotated on each use. Reuse of a previous token revokes the session. Lifetime 30 days, sliding; 90 for mobile. |
| Dashboard transport | Same origin, so the refresh token is an `HttpOnly; Secure; SameSite=Strict` cookie. The access token stays in memory. |
| Mobile transport | Bearer token. Stored in `expo-secure-store` per connection. |
| CSRF | `SameSite=Strict`, plus requiring `Authorization` on all data routes. Only the refresh route uses the cookie, and it also checks `Origin`. |
| Login throttling | Strict fixed-window counters in the `AuthGuard` Durable Object, one object per hashed key: 10 attempts per account and 50 per IP address per 15 minutes. A successful login clears the account counter. The account key is derived from the submitted email, so unknown accounts behave identically. Trade-off: anyone can lock an account out of password login for 15 minutes by failing on purpose. Reset still works, and existing sessions are unaffected. |
| Enumeration | Login and reset give identical responses and comparable timing whether or not the account exists. Login hashes against a dummy for unknown, disabled, and placeholder accounts. A reset request answers 202 before looking anything up, doing that work in `waitUntil`. |
| Refresh reuse | Rotation and reuse detection are one `batch()`. Presenting the previous token revokes that session, and only that session. One generation is kept, so an older token simply fails. Two concurrent refreshes count as reuse, so the dashboard must serialise refreshes across tabs (Web Locks), and a client that loses a refresh response signs in again. Both fail safe. |
| Password reset | Limit 3 per address and 20 per IP address per hour, silently past the limit. The job holds only the user ID, and the consumer creates the token as it sends, so no token reaches a queue or `failed_jobs`. Tokens last 1 hour, are stored as SHA-256, and travel in the URL fragment so they stay out of access logs. Confirming revokes every session and every outstanding reset token for the user. Confirmations are limited to 20 per IP address per 15 minutes. |
| Signing keys | `AUTH_SIGNING_KEY` is JSON: `{ active: { kid, privateKey, publicKey }, retired?: [{ kid, publicKey }] }`. To rotate, move the old key to `retired` and remove it once its tokens have expired, after 15 minutes. |

## RBAC

| Capability | Installation admin | Supervisor | Agent |
|---|---|---|---|
| View and reply to conversations, add notes | Only after joining | Yes | Yes |
| Assign to self | Only after joining | Yes | Yes |
| Assign to others, transfer | Only after joining, as a supervisor | Yes | Own only |
| Merge contacts, delete tags | Only after joining, as a supervisor | Yes | No |
| Correct a visitor's language | Only after joining, as a supervisor | Yes | No |
| Manage canned responses (later) | Only after joining, as a supervisor | Yes | No |
| Manage people and the admin role, and assign them to workspaces | Yes | No | No |
| Create and rename workspaces. Manage websites, and later automation and email settings | Yes, without joining | No | No |

**Supervisor and agent are workspace roles. Installation admin is a flag on the account**, and there is no owner or admin inside a workspace ([ADR-0016](decisions/0016-installation-admin-replaces-workspace-managers.md)). Being an admin gives no read access to a workspace: without a membership it gets 404 there, and adding yourself leaves an audit row. Every admin has power over every workspace, so each company runs its own installation.

`packages/auth` holds the workspace roles as pure data and functions, with a table-driven test. It gives an early 403. Admin changes are decided in SQL at commit, so a role taken away mid-request counts.

## Workspaces and accounts

| Item | Decision |
|---|---|
| Creating a workspace | Only an installation admin. Nobody joins it by creating it. The first workspace and admin come from the CLI. |
| Creating an account | Only an installation admin, or the CLI for the first one. There is no signup and there are no invitations. |
| New account link | Created as the email is sent, so no token reaches a queue, and stored as SHA-256. Lasts 7 days. |
| New account limit | 30 per admin per hour, because each one sends an email to any address. |
| Removing and deactivating | Nobody can delete an account. Removing a member, or deactivating an account, ends access and can be undone, and the person's messages keep their name ([ADR-0015](decisions/0015-installation-admin-and-reversible-removal.md)). |
| Allowed origins | Exact origins only: no wildcards or paths, and plain HTTP only on the local machine. |

## Visitor authentication

The `websiteKey` is **public by design** and grants only the ability to ask for a visitor session.

```text
POST /api/v1/widget/sessions { websiteKey, refreshToken? } + Origin header
  -> check Origin against the website's allowed list
  -> returns a visitor access token (JWT, 1 hour, aud = "visitor", claims: visitorId, websiteId, workspaceId)
     and a long-lived visitor refresh token (opaque, hashed in D1)
```

| Control | Notes |
|---|---|
| Origin allowlist | A control against *other websites embedding the widget*. **Not authentication:** any script can forge the header. Do not rely on it for anything else. |
| Token scope | Can touch only this visitor's conversations. Internal notes filtered by `visibility` in SQL, in a repository of its own that has no way to return them. The audience claim keeps visitor and agent tokens from working in each other's routes. |
| Replays | A replayed `clientMessageId` returns a message only if this visitor sent it. An ID already used by anyone else answers 409, because returning that message could reveal an internal note. |
| Agent names | Hidden from visitors unless the website sets `showAgentNames`. |
| Storage | `localStorage` on the host site. With `data-consent="pending"` on the script tag, everything stays in `sessionStorage` until the page calls `window.OpenChat.grantConsent()`. An XSS bug on the host site can read it, but it only exposes that visitor's own chat. |
| Rendering | Message content is only ever a text node, in a Shadow DOM. The colour from settings is validated, and applied through the CSSOM. |
| Host page policy | A site with a CSP allows the installation for `script-src` and `connect-src`. The loader passes its nonce on to the chat bundle, and styles do not need `style-src`. A website that requires Turnstile also allows `https://challenges.cloudflare.com` for `script-src` and `frame-src`. |
| Turnstile | Optional per website, with installation-level keys, so the Cloudflare widget's hostnames must list every website that uses them. Checked when a new visitor session starts, not per message, because the session is what the rate limits count. A known visitor resumes with no check. If Cloudflare cannot answer, or the keys are wrong or gone, new visitors get 503: it fails closed, and existing visitors carry on. The script loads only when a new visitor first writes on a website that opted in. |
| Abuse controls | Strict counters in the `AuthGuard` Durable Object: 120 requests a minute per visitor, checked before the database. 20 messages a minute per visitor, 600 per website, and 1,200 other writes per website. 30 sessions an hour per IP address, and 3,000 per website. Ten sockets per visitor in a room. **Nothing yet caps total stored data**, per [the review](security-review-m1b.md#gaps-to-close-later). The rate limit binding would be cheaper but is approximate; the load test decides whether to switch. Trade-off: a flood can use up a website's allowance and hold up its real visitors, though not other websites; quotas on attachments per visitor and per day; optional Turnstile on the first message. Also 60 messages a minute per address, 20,000 per website a day, and 4,000 characters a message, which the operator can change for the whole installation. Every limit by address counts an IPv6 /64 as one address. See [abuse limits](../operations/abuse-limits.md). |
| Identity upgrade | Email provided by a visitor is unverified, and never merges into an existing contact automatically. Otherwise anyone could type a customer's email and read their history. Merging is an agent action. **A returning visitor only sees history tied to their own visitor token.** |
| Signed identity (later) | A host site can pass an HMAC of its user ID, signed server-side, to link identities safely. |

## Attachments

Uploads stream through the Worker to R2 ([ADR-0008](decisions/0008-attachment-transfer.md)).

| Control | Detail |
|---|---|
| Name | The extension must match the declared type, because people open saved files by name. Characters that reorder or hide text are removed |
| Type check | Allowlist by declared type *and* first bytes: PNG, JPEG, GIF, WebP, PDF, ZIP, DOCX, XLSX, PPTX, plain text, and CSV. Text has no signature, so it must have no NUL byte and must not start with `<` |
| Blocked types | HTML, SVG, XML, and script types, in either direction |
| Size | 25 MB, below the Cloudflare request limit of 100 MB. Not yet configurable per workspace. The declared length is enforced by the stream |
| Claiming | A message can name only files its sender uploaded to that conversation, in the last 23 hours, not yet on a message. Checked in SQL in the insert, so a bad ID means no message. Visitors can upload only into an existing conversation, 20 files an hour, and 500 an hour per website |
| Download | Normal auth only, with the token in a header, so that no file has a URL that works on its own. Clients fetch a file and show it from a `blob:` URL. A visitor gets only files on public messages in their own conversations |
| Response headers | `Content-Disposition: attachment` (inline only for an allowlist of raster images), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: no-store` |
| Orphans | Unattached uploads deleted after 24 hours, hourly, 200 at a time. A message cannot claim one past 23 hours, so a send cannot race the sweep |
| Bucket | Private. No public access or custom domain on it |
| Malware scanning | Future integration through a hook in `attachment.process` |

The iOS app, which is not in this repository, removes metadata, including location, from photos before upload, and sends documents unchanged. The server does not rely on it: it treats every upload as untrusted.

## Secrets

| Secret | Where | Rotation |
|---|---|---|
| `AUTH_SIGNING_KEY` (Ed25519) | Worker secret | Key ID in the JWT header; two active keys during rotation |
| Socket tickets | Signed with the access token key | One key to rotate. Tickets carry `aud: 'realtime'`, last 30 seconds, and neither kind of token is accepted as the other |
| `RELAY_SIGNING_KEY` (Ed25519) | Worker secret | Key ID; relay accepts registered keys |
| `OPERATOR_TOKEN` | Worker secret, and `.openchat/<name>/operator-token` on the deploying computer | Opens `/health/*` only, which return counts and times, never content or IDs. To rotate, delete `operatorTokenSet` from `state.json` and run `oc deploy` |
| `SETUP_CODE` | Worker secret, chosen by the person who used the [Deploy to Cloudflare button](../operations/one-click-deploy.md). Absent from an `oc deploy` installation | Lets its holder create the first admin, once, while no installation exists ([ADR-0020](decisions/0020-deploy-button-and-browser-setup.md)). Useless afterwards, so delete it rather than rotate it |
| `DATA_ENCRYPTION_KEY` | Worker secret | `key_version` per row |
| Workspace email credentials | D1, AES-GCM encrypted with the key above and bound to `workspace_id` as associated data | Re-encryption job |
| APNs `.p8` | Relay Worker secret only | Apple key rotation, documented |

Spec §9 calls for Workers Secrets everywhere, but per-workspace credentials are created at runtime through the dashboard, so they cannot be Worker secrets. Encryption at the application layer is the alternative.

CI runs secret scanning. `.dev.vars.example` contains placeholders only, and `.dev.vars` is ignored by Git.

## Web and API

- Strict CSP on the dashboard, from `apps/dashboard/public/_headers`, with no third-party scripts or inline code.
- `Strict-Transport-Security: max-age=31536000` on the dashboard and every `/api/*` answer, so a browser that has visited once never tries plain HTTP on a custom domain. Not `includeSubDomains`, since other hosts under the operator's domain are theirs to decide. `workers.dev` is HTTPS-only already.
- The dashboard keeps its access token in memory. Refreshes are serialised by one promise per tab and a Web Lock across tabs, because a repeated refresh revokes the session. Tokens in emailed links are removed from the address bar on load.
- CORS allowed only on `/api/v1/widget/*`. These routes use bearer tokens and no cookies, so the response headers reflect the caller, and each route refuses an origin its website does not allow. The dashboard is same-origin and needs none.
- All input validated with Zod. Request bodies have explicit limits.
- Message content is plain text, rendered escaped on every client. There is no HTML message type. Links are detected on display and get `rel="noopener noreferrer"`.
- Email templates escape interpolated values.
- `/.well-known/security.txt` names the operator, once one is set. See [Disclosure](#disclosure).
- The discovery document publishes the deployed release, because the AGPL source offer needs it. That tells an attacker which release to probe. The trade-off is in [licensing](../operations/licensing.md#the-source-offer).

## Disclosure

Two parties receive reports, so there are two policies:

- **The project**, for vulnerabilities in OpenChat's code and in the managed relay: [`SECURITY.md`](../../SECURITY.md). Reports go through GitHub's private vulnerability reporting, which is enabled on the repository.
- **Each installation's operator**, for their deployment and their customers' data. An installation serves `/.well-known/security.txt` ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)) once the operator sets a contact with `oc deploy --security-contact`. Without one it answers 404, because the file must name someone, and the project cannot answer for another operator's data. The managed relay serves one too.

The file is built by `securityTxt` in `@openchat/shared`, for both Workers:

- `Contact`: up to five `mailto:` addresses or `https:` URLs. Anything else, including a value with a line break, is refused by the CLI and ignored by the Worker, so a setting cannot add fields to the file.
- `Expires`: 30 days ahead, at midnight UTC, written on each request, so the file never lapses while the setting stands. RFC 9116 asks for less than a year.
- `Policy`, if set with `--security-policy`; `Preferred-Languages: en`; and `Canonical`, the address it was requested at.
- A comment that names the operator as the contact for the service, and the project's security page for the software.

The managed relay names the project's advisory page.

## Logging

The shared logger takes a typed field allowlist, so sensitive data has to be deliberately added. Every line has `requestId`, `installationId`, `workspaceId`, and `route`. Never logged: passwords, tokens, tickets, keys, message content, or email addresses and names.

## Audit log

Admin actions, membership changes, erasure, failed-job replays, and retention sweeps each write a row to `audit_log`, usually as the first statement of the batch that does the work ([Pattern 2a](data-model.md#pattern-2a-the-audit-row-as-the-guard)). A row holds the actor, the action, IDs of the workspace and target, and small flat metadata such as a role or a count. Never message content, addresses, or names of visitors.

Installation admins read it on the dashboard's **Audit log** page (`GET /api/v1/admin/audit-log`), newest first, for the whole installation or one workspace. People, members, workspaces, and websites are shown by name. A contact, conversation, relay, or job stays an ID, so the log names no visitor. Nobody else can read it. Rows are kept until their workspace is deleted. Retention does not touch them.

## The AI assistant

[ADR-0022](decisions/0022-ai-assistant.md). Supervisors set it up (`assistant.manage`). From step 2, a supervisor can let it answer visitors, so a stranger's words reach the model. From step 3, it can learn from resolved conversations.

**Reading web pages** is a request to the internet on a supervisor's behalf, so it is narrow. The address must be `https`, with no user name, password or port, on the host of one of the website's allowed origins, or a subdomain of it. The reader follows links only on the same origin and under the start page's folder, honours `robots.txt` (RFC 9309) and `noindex` and `nofollow`, stops at 50 pages, 2 MB a page and 10 seconds a request, and identifies itself as `OpenChat-Assistant/1.0 (+https://openchat.run)`. The start page may redirect between the bare domain and `www.`, and nowhere else. Only text is kept.

**Prompts.** Sources are quoted to the model inside `<source>` tags, after removing any such tags from them, and the system prompt says they are material, not instructions. The model must answer from them alone or reply `NO_ANSWER`, which is shown as declining. Links in an answer that do not appear in the sources are removed. This makes misuse harder, not impossible: a page the company publishes can still steer its own assistant.

**Visitors.** The model sees the visitor's public messages and the assistant's own answers in the conversation, never notes, members' messages, contact details or other conversations. The rules are repeated after the visitor's words, because on real Workers AI Llama 3.3 obeyed "ignore all previous instructions" without that. Messages that look like an attempt to give it instructions, in English and a few other languages, are handed over without asking the model. A visitor who asks for a person, in the widget's 11 languages, is handed over too. Each answer is labelled AI in the widget and the inbox, and the worst a visitor can make it do is say something wrong to that same visitor, in a conversation the team can read. Answers count towards the daily limit, and a conversation gets at most 5.

**The team's tone.** A supervisor can write up to 500 characters on how the assistant should write. It is free text from a signed-in supervisor, and is still treated as quoted material: it goes after the rules, inside `<style>` tags it cannot close, under a line saying it changes how the assistant writes and never the rules or what it may answer from. The reminder after the visitor's words stays, with one sentence added so that it does not cancel the tone. So the worst a supervisor's text can do is what a wrong source can: make the assistant say something wrong on that supervisor's own website. The handover message, up to 300 characters, never reaches the model: it is stored as the handover's content and shown as plain text.

**Learning.** What the model reads to learn is the visitor's and members' public text messages: the query cannot return a note, a system message or the assistant's own answers, and the type that carries them has no field for one. The prompt asks for one general question and answer with no personal details, or `NONE`. Then a check rejects the result if the model's text holds an email address, a phone number, a web address with a query string, five digits or more together, or the name of the visitor, of a member who wrote in the conversation, or the part before the @ of the visitor's address. That check is a word list, and can miss a name written another way; approval before use, on by default, is the main defence. Turning approval off is for the whole workspace and is audited. Web addresses the team did not write are removed, as in answers. A learned answer is deleted with its conversation, by erasure or retention.

**Help articles** (ADR-0023, step 4) are a source once a website has the assistant: published ones only, and only of that website. They are quoted like any source. Their links keep their address, so an answer can give it, and links to the help centre become absolute; the address of the article's own page is allowed too. Unpublishing or deleting takes the article out at once, because its chunks are only joined while it is published; its vectors are removed through the outbox.

**Data.** Questions, sources and answers go to Workers AI in the installation's own Cloudflare account. Questions asked in the test panel are not stored, nor is its conversation, which the dashboard holds and sends back with each question, at most 20 turns of which the model reads the last 9; a visitor's messages and the assistant's answers are stored as messages, like any other. Nothing about the assistant is logged except IDs, counts and outcomes.

## The help centre

[ADR-0023](decisions/0023-help-centre.md). The only pages an installation serves without sign-in apart from the widget, at `/help/<slug>`, so they are narrow.

- **Only published articles.** Every public query names the website found by its slug and requires `status = 'published'`. A website without a slug has no public pages. Drafts are readable by any member, so that an agent can find an article to link, and changed only by supervisors (`help.manage`).
- **No HTML from writers.** Articles are a fixed Markdown subset, rendered on save by `renderHelpMarkdown` in `@openchat/shared`, which escapes every character of the source and builds the few tags it allows. Links must be `https`, `mailto`, or a path under `/help/`; external links get `rel="noopener nofollow ugc"`. Images must be `/help-assets/<id>`. The dashboard's preview uses the same function.
- **Pages have no script.** `Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, and no cookies. Search results are `noindex`.
- **Images** are checked as attachments are: the declared type must be an image and agree with the first bytes, and the name with the type; SVG is refused. They are served with `Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`, and are public at an ID that cannot be guessed, including images used only in drafts. Deleting one removes it.
- **Load.** A cached page costs one indexed read of the website. Anything else, including every search, is limited per IP (300 a minute). Search terms are not stored or logged.

### The widget's Help tab

- **Same rules as the public pages.** Published articles of the website the key names, from an Origin the website allows, limited per IP. No session is created, so reading leaves no trace of the visitor.
- **The panel sets one piece of HTML,** an article's `body_html`, which only `renderHelpMarkdown` ever wrote. Message content stays text nodes. The widget's Shadow DOM keeps the article's few tags from the host page's styles.
- **`helpArticleId` is checked in SQL** on insert: an ID that is not a published article of the visitor's website is stored as null, not refused, so it reveals nothing about other websites.

### Languages

- **A visitor's language is a well-formed BCP 47 tag of at most 35 characters,** checked by the contract and stored in its canonical spelling. Only the conversation's first one is kept, so a visitor cannot change what the team sees after it is set; only a supervisor can (`conversation.language`), and that is recorded as a conversation event.
- **A member's language** is one of OpenChat's eleven, and each person can change only their own.

### Automatic translation

- **Visitors never see translations.** The visitor message query and mapper do not read them, and the `message.translated` event is dropped by `toVisitorEvent` and goes only to the workspace hub, carrying IDs and languages, not text.
- **A visitor's message cannot steer the default model.** `m2m100` only translates. A text model, which a supervisor can choose, gets the message inside `<message>` tags with a reminder after it, as the assistant does; what it writes is shown only to members, labelled, with the original beside it. On real Workers AI, Llama 3.3 translated "ignore all previous instructions…" rather than obeying it.
- **A member's reply is translated only when they ask** (`translate: true`, which the dashboard sends while translation is on and the visitor reads another language), with the assistant's text model. If it cannot be translated, at the daily limit, or without Workers AI, nothing is sent, so a visitor never gets an untranslated reply the member did not choose. The visitor's widget labels it "Translated automatically", with the member's words a tap away. Internal notes are never translated.
- **Off by default**, and turned on or off only by supervisors (`translation.manage`), audited as `translation.settings_changed`. Every member's request counts against the workspace's daily character limit, taken before the model is called.
- **Personal data.** Every visitor message in a workspace that turns it on goes to Workers AI, as for the assistant. Translations are deleted with their messages and included in contact export.

### Draft with AI

- **It reads only the company's own pages.** Links follow the assistant's rules: `https`, on the host of one of the website's allowed origins, no credentials or ports, robots.txt respected, size and time limits, and redirects checked. Reading the website starts at the first allowed origin.
- **Files** must be PDF, Word, OpenDocument, HTML, Markdown or text. The extension decides the kind and the first bytes must agree: `%PDF-`, a zip, or UTF-8 with no NUL. They may be up to 10 MB each, and 10 per run. They are read whole, checked against `Content-Length`, and kept in R2 only while the run is open.
- **The material is untrusted.** The prompt says it is never instructions. The model has no tools. What it writes is a draft, never published by itself. Links and email addresses are kept only if they appear in the run's material, and images are removed. The text then goes through the same renderer as any article.
- **Only supervisors** start runs (`help.manage`), and a run reads only for its own website.
- **Without Workers AI** the routes answer 409 `drafting_unavailable`, and the dashboard does not offer it.

## Privacy

Customers are the controllers of visitor data. For GDPR and similar laws, the product needs:

- Export and erase-contact operations. Built, for an installation admin who is a member of the workspace. See [contact export and erasure](data-model.md#contact-export-and-erasure).
- A way to erase a former agent's name on request. Removal keeps it, and no tool for this exists yet.
- Consent evidence for follow-ups.
- A widget consent mode which uses session-only storage until the host site grants consent. Built.
- Retention settings. Built: a workspace can delete closed conversations after a set time, and every installation deletes expired sessions, old job records, and visitors who never wrote. See [retention](data-model.md#retention).
- A location hint for D1 and a jurisdiction for Durable Objects and R2 where needed. See [open question Q10](open-questions.md).

The operator of a **managed relay** holds device tokens and recipient IDs, which may be personal data. That operator needs a privacy policy and terms. See [Q5](open-questions.md).

## Threat summary

| Threat | Primary defence |
|---|---|
| Cross-tenant read or write | Isolation layers above |
| Internal note shown to a visitor | `CHECK` constraint, `VisitorEvent` type, SQL filter, test matrix |
| Account takeover by a guessed email in the widget | No automatic contact merging |
| Stolen refresh token | Rotation with reuse detection |
| Malicious installation harvesting tokens | Tokens never reach installations; relay allowlist fixed at build time |
| Spoofed push | Ed25519, device-submitted grants, replay protection |
| Forged widget origin | Accepted limitation; limited by rate limits and quotas |
| Stored XSS | Plain-text messages; attachment headers |
| Denial of service through login or uploads | Throttles and quotas; the Cloudflare edge in front |
