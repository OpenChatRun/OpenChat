# ADR-0024: Automatic translation between visitors and the team

**Status:** Accepted, 2026-11-20, by the owner. The owner chose: member replies translated silently on send, without a preview; `m2m100` for visitor messages by default; notes not translated.

## Context

The roadmap promises: "Visitors write in their own language and agents in theirs; each side sees the conversation translated, with the original one tap away."

What we have today, and what is missing:

- The widget picks a language (from the page, `data-locale` or the browser) but does not tell the server. Nothing stores a visitor's language.
- A member's dashboard language is kept only in their browser (`openchat.language` in local storage). Nothing stores it on the server either, and the apps keep their own.
- The AI assistant already answers in the visitor's language ([ADR-0022](0022-ai-assistant.md)), so it needs no translation.

What makes this harder than it looks:

- **Two directions, different trust.** A visitor's message is untrusted text that a model will read; its translation is shown only to members. A member's reply is trusted, but its translation is what the company says to the customer.
- **Latency.** A visitor waiting for an answer should not see it appear in a language they do not read and then change, nor wait long for it.
- **The model.** Workers AI has one general translation model, `@cf/meta/m2m100-1.2b`, which is fast but weak on informal chat, and text models such as Llama 3.3, which translate better but cost more and can be steered by what they translate.
- **Notes must never reach visitors** (AGENTS.md rule 4); translation must not create a path for them.
- **Personal data.** Every translated message goes to Workers AI. On Cloud that needs the same legal update as the assistant.
- **Erasure and export.** Translations are derived from messages and must go with them.

## Decision

### Languages

- **The visitor's language.** The widget sends its chosen language when it creates a session and a conversation. The conversation stores it as `visitor_language` (one of the widget's eleven, or a BCP 47 tag the browser gave). Supervisors can change it on the conversation if it is wrong.
- **A member's language.** Members gain `language` on the server. The dashboard and the apps write it when the member changes their language, and use it as the default on a new device.
- A conversation needs translation when its visitor's language differs from the reading member's. Languages are compared by their primary subtag, so `en-GB` and `en-US` match, but `zh-Hans` and `zh-Hant` do not.

### What is translated

- **Visitor messages**, to the language of each member who reads them, after they are stored. A job on the assistant queue translates a public visitor text message into the languages of the workspace's members who have one different from the visitor's, at most three per message. Members whose language was not covered can ask for it with **Translate**, which runs the same job for one language.
- **Member replies**, to the visitor's language, when the member sends them. A member writes in their own language and sends, with no preview, so answering is as fast as it is today apart from the model call. The original and the translation are stored; the visitor sees the translation, and the member sees it under their own words once sent.
- Not translated: internal notes, by the owner's choice, system messages, the assistant's answers (already in the visitor's language), attachments' names, and email.

### Where translations live

- A new table, `message_translations`: `workspace_id`, `message_id`, `language`, `content`, `model`, `created_at`, unique `(message_id, language)`. It references `messages` with `ON DELETE CASCADE`, so erasure and retention delete translations with their messages. Nothing is rebuilt.
- A member reply that was sent translated stores what the member wrote as a translation in **their** language, and what the visitor received as the message `content`. So the message is what the customer actually read, which is what export, the audit trail and any dispute need. A new column, `messages.original_language`, says the member wrote in another language.
- Contact export includes translations, labelled as machine translations.

### What each side sees

- **Members**: a visitor message in another language shows its translation, labelled **Translated from Deutsch**, with **Show original** one tap away. Until the translation arrives (usually about a second), the original shows with "Translating…".
- **Visitors**: a member's reply shows in the visitor's language, labelled **Translated automatically**, with **Show original**. The visitor never waits: the member's request translates and stores before it commits, so the reply arrives once, already translated.
- If translation fails or times out (5 seconds), a member reply is not sent: the composer keeps the text and offers **Try again** or **Send untranslated**, so nothing reaches the visitor in a language they did not choose without the member knowing. A visitor message shows the original with **Translate** to try again.

### The model

- **Member replies** use a text model (the assistant's default, Llama 3.3) with a fixed prompt, because quality matters most in what the company says, and the input is the member's own words.
- **Visitor messages** use `m2m100-1.2b` by default: it cannot follow instructions, so text that says "ignore the above" is translated, not obeyed. A workspace can choose the text model for better quality, with the same prompt protections as the assistant (the text quoted in tags, a reminder after it), knowing that the result is shown only to members, labelled, with the original one tap away.
- The choice of models is kept in one place, as the assistant's is, because Workers AI models are added and retired.

### Settings, limits and cost

- Off by default. A supervisor turns it on per workspace. The setting is audited.
- A daily limit per workspace of translated characters, with a default an installation admin can change. At the limit, translation stops for the day and members see the originals; no message is held back.
- Usage is counted per day with the assistant's, so an operator sees the cost.
- On Cloud, off until the privacy documents cover Workers AI, as the assistant is.

### Build order

1. **Languages.** Store the visitor's and members' languages. Useful alone: the inbox shows the visitor's language.
2. **Visitor messages for members.** Translation job, `message_translations`, labels, Show original, Translate on request.
3. **Member replies for visitors.** Send translated, widget labels, and the original stored for the member.
4. **The apps**, in the private repository, show translations and send translated replies.

## Consequences

- An agent who speaks one language can answer visitors in eleven, and every translated line is labelled for both sides.
- A model sees every visitor message in a workspace that turns this on, and every reply its members translate. That is the same data path as the assistant, and needs the same legal cover.
- Sending a reply gets slower by about a second when it is translated.
- The message a visitor received is the one stored, so the record is accurate; the member's own words are kept beside it.

## Alternatives considered

- **Translate on display, never stored.** No new table, but every member opening a conversation pays for a model call, and the visitor's record would not say what they were shown.
- **A preview before sending.** Lets a member check the translation, but most cannot judge a language they do not read, and it slows every reply. The owner chose silent send.
- **Send the member's reply first and replace it with the translation.** No wait for the member, but the visitor sees text change under them, and push notifications would carry the untranslated text.
- **A text model for everything.** Better translations of visitors' messages, but a visitor could steer what members read. Offered as an option, not the default.
- **An external provider such as DeepL.** Better quality, but a new processor outside Cloudflare, a new secret per installation, and a stack addition. It can be added later behind the same interface, with its own ADR.
