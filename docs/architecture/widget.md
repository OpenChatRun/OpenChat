# Website widget

The widget is two files, both served by the installation:

- `widget.js`, the loader. It has no dependencies and must stay under 5 KB gzipped. It draws the button and makes no API call.
- `chat.js`, the panel, in Preact, under 40 KB gzipped. It loads when the browser is idle, or on the first click.

Both live in a Shadow DOM, so the host page's styles cannot reach them and theirs cannot leak out. `tooling/scripts/check-budget.mjs` enforces the size limits in CI.

## Embedding

```html
<script src="https://<installation>/widget/widget.js" data-website-key="wk_…" async></script>
```

| Attribute | `window.OpenChatConfig` | What it does |
|---|---|---|
| `data-website-key` | `websiteKey` | Which website this is. Required. The page's origin must be in the website's allowed origins |
| `data-consent="pending"` | `consent: 'pending'` | Keeps everything in `sessionStorage` until the page calls `window.OpenChat.grantConsent()`. See [security](security.md#visitor-authentication) |
| `data-locale` | `locale` | The widget's language, such as `fr` or `zh-Hant`. See [Languages](#languages) |
| | `apiUrl` | The API, if not where `widget.js` came from. For local development |

| | `attributes` | What the page knows about its visitor. See [Attributes](#attributes) |

`window.OpenChat` also has `open()`, `close()`, and `setAttributes()`.

## Attributes

A page can tell the team what it knows about its visitor, such as a customer number or a plan, with `OpenChatConfig.attributes` or `window.OpenChat.setAttributes({...})`. The team sees it on the contact, read-only, as `attributes`.

- **Shape.** A flat object of at most 20 entries. A name has 1 to 40 characters; a value is a string of at most 255, a finite number, or a boolean; no control characters. `VISITOR_ATTRIBUTE_LIMITS` in the contract holds the numbers, and `apps/widget/src/attributes.ts` repeats them, because the bundle cannot import the contract.
- **The widget cleans it; the API refuses.** `PATCH /api/v1/widget/me` answers 400 for one bad entry. So that a page's mistake with one value does not lose the rest, the chat bundle leaves out what would be refused and cuts what is too long.
- **Sent only once there is a conversation,** as the visitor's page is, so a page view still makes no session and no contact. It is sent again when it changes, and once on each page load after that. A failure is not retried: the next page sends it.
- **Replaces, never merges.** The page states what it knows now. An empty object clears it. A profile update without `attributes` leaves it alone.
- **Stored on the contact,** in `contacts.attributes_json`, so two browsers of one contact write over each other. Merging contacts is not built.
- **Its own limit.** An update that carries only `attributes` counts against the per-website limit on page reports, not the one for other visitor writes, since both are sent by the widget itself on each page.
- **Unverified.** It comes from the visitor's browser with the visitor's token, so a visitor can send anything about themselves. The dashboard and the app say so. A signed form, where the website's server vouches for the values, is not built.
- **Not consent-gated.** `data-consent="pending"` is about what the widget stores in the browser. Attributes are not stored there, and leave only for a visitor who has started a conversation.
- **Version skew.** The loader keeps the page's value on the handoff, and calls the chat bundle's `setAttributes` only if it has one.

## The contact's email

The email on a contact comes only from the visitor, through the widget's own form, with their choice about follow-up emails. `PATCH …/contacts/{id}` takes a name and a phone number, and refuses a body that names `email` with 400. Until this change a member could set or change it, which cleared the consent, and let a member point a contact at an address its owner never gave.

## The Help tab

[ADR-0023](decisions/0023-help-centre.md), step 3. When the website has published help articles, the bootstrap lists their languages in `helpLanguages`, and the panel shows **Chat** and **Help** tabs. It opens on Help until the visitor has a conversation.

- **Reading needs no session.** `GET /api/v1/widget/help` (list, or search with `q`) and `GET /api/v1/widget/help/articles/{id}` take the website key, check the Origin as the bootstrap does, and are limited per IP with the public help centre (300 a minute). A visitor who only reads never becomes a visitor row or a contact.
- **Language.** The widget asks in its own language. The server answers in that language if it has articles, else English, else the language with most.
- **The list** is the first 100 published articles by position, grouped by collection, as on the help centre's home page; not the most read. Search reaches the rest. The list and articles are cached for 30 seconds by website key, as the bootstrap is; searches are not cached.
- **An article is the one HTML the panel sets.** It is `body_html`, rendered from an allow-list on save, with `/help-assets/` images and `/help/` links made absolute on the installation, and help links opening in a new tab.
- **Was this helpful?** under an article sends `POST /api/v1/widget/help/articles/{id}/feedback` with the website key and `helpful`, and thanks the visitor whatever comes back. Opening an article counts a view. Neither needs a session or sends anything about the visitor. The widget remembers which articles were answered until the page is reloaded; the server counts one answer per address and article in a day.
- **Still need help?** switches to Chat. If the visitor has no conversation yet, the first message sends `helpArticleId`, which is kept on the conversation only if it names a published article of the same website. The inbox shows "Came from the help article …".
- **Freshness.** The tab appears or goes with the bootstrap, which is cached for 30 seconds.

## Translated replies

A team reply translated automatically (ADR-0024) carries `original`, what the team member wrote. The widget labels it **Translated automatically**, with **Show original** to see the member's words, marked with their language.

## Languages

The widget speaks English, Spanish, French, German, Italian, Portuguese, Dutch, Japanese, Korean, Simplified Chinese, and Traditional Chinese. It chooses the first of these that it speaks:

1. `data-locale` on the script tag, or `OpenChatConfig.locale`. A site in several languages sets it per page.
2. The website's **Widget language** setting, under Workspaces, unless it is Automatic.
3. The page's `<html lang>`.
4. The visitor's browser languages, in order.
5. English.

A tag matches by its language, so `pt-BR` is Portuguese and `de-AT` German. Chinese is Traditional for `zh-Hant`, `zh-TW`, `zh-HK`, and `zh-MO`, and Simplified otherwise. The panel and the button carry a `lang` attribute, so that screen readers pronounce them correctly. File sizes use the language's number format and units.

The button's label is chosen by the loader, before the website's setting is known, from steps 1, 3, and 4. The chat bundle corrects it once the setting arrives.

**The visitor's language, for translation** ([ADR-0024](decisions/0024-automatic-translation.md)). Each message the visitor sends carries `language`: the language the widget chose, or, if it speaks none of those named in steps 1 to 4, the first one named, so that a visitor whose browser is in Russian is `ru-RU`, not English. The server keeps the first one it receives on the conversation.

**Not translated:** the welcome message, which is shown as the site owner wrote it, and agents' replies. Follow-up emails are in English. The dashboard has [its own language choice](dashboard.md#languages).

**Right-to-left languages,** such as Arabic and Hebrew, are not supported yet. They need the panel's layout mirrored as well as its strings.

**The translations have not been reviewed by native speakers.** They were written with care and are checked for completeness by `apps/widget/src/locale.test.ts`, which also keeps the list in step with the API's `language` setting. Corrections are welcome: change `apps/widget/src/strings.ts`, where English is the source and every language must have every key.

### Adding a language

1. Add it to `LOCALES` and `OPEN_LABEL` in `apps/widget/src/locale.ts`, and its strings to `apps/widget/src/strings.ts`.
2. Add it to the `language` enum in `WidgetSettingsSchema`, run `pnpm contracts:generate`, and add it to the dashboard's `WIDGET_LANGUAGES`.
3. Check the bundle budget with `pnpm verify`.
