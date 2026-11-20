# ADR-0023: A help centre, searchable from the widget and a public page

**Status:** Accepted, 2026-11-20, by the owner. The owner chose: the public page on the installation's own address (`/help/<slug>`), no custom domain for now; articles that AI can draft from the website, links and files; and the help centre on for everyone on Cloud, except AI drafting, which needs Workers AI.

## Context

The roadmap promises "a help centre: articles your visitors can search from the widget and a public page, which the AI assistant also answers from." Tidio, Crisp and Intercom all have one, and a visitor who finds the answer themselves never opens a conversation.

What makes this harder than it looks:

- **Search on D1.** D1 supports SQLite's FTS5, but [D1 export does not support virtual tables](https://developers.cloudflare.com/d1/best-practices/import-export-data/), "including databases with virtual tables". Our [backup procedure](../../operations/backup-and-restore.md) is a D1 export, so one FTS5 table would break every installation's backups. FTS5's default tokenizer also splits Chinese and Japanese poorly, and the widget speaks both.
- **A public page is a new surface.** Until now, everything an installation serves without sign-in is the widget and its API, both keyed by a website. A public page is crawled, cached and linked to, so it must never show a draft, and must be cheap to serve.
- **Articles are written by people and read by strangers.** The editor must not let a member put script on a page that visitors open, and must not need a rich-text library that breaks the widget's budget (`chat.js` under 40 KB gzipped).
- **Languages.** A company with visitors in several languages needs the same article in each, and the widget must pick the visitor's.
- **Writing articles is the slow part.** Most companies already have the material, on their website or in documents. The owner asked that articles can be drafted by AI from the website, links and files.
- **The assistant** already has sources with generations, chunking, vectors and removal ([ADR-0022](0022-ai-assistant.md)). Articles should reuse that rather than add a second pipeline.

## Decision

### What it does

- A help centre belongs to a **website**, as the widget and the assistant do. It is off until a supervisor publishes the first article.
- Supervisors (a new capability, `help.manage`, given to the roles that have `assistant.manage`) write articles in the dashboard, or have AI draft them (below), group them in **collections**, and publish or unpublish them. Agents can read drafts, so they can link an article in a reply.
- An article has a title, a short summary, a body, a collection, a language, and a status: `draft` or `published`. Articles in different languages that say the same thing share a `translation_group_id`, so the widget and the page can offer "also in Deutsch".
- **Public page**: `https://<installation>/help/<website-slug>`, with a page per collection and per article (`/help/<slug>/<article-slug>`). It is server-rendered HTML with no JavaScript needed to read it, in the website's colours, with a search box. A website chooses a slug when it turns the help centre on. A custom domain is not offered: Workers Custom Domains need the zone in the same Cloudflare account, and the owner chose the path. It can come later in its own ADR.
- **Widget**: a **Help** tab beside the conversation, with search and the most-read articles. An article opens inside the panel. From an article, "Still need help?" starts a conversation, and the conversation records which article the visitor came from, so the team sees it.
- **Assistant**: when a website has the assistant, its published articles are a source automatically, with a link to the public page, so an answer can say "see How to return an item".

### Body format

- Articles are written in **Markdown**, a small fixed subset: headings, paragraphs, bold and italic, lists, links, inline code, quotes, and images. No raw HTML.
- The server renders it to HTML once, when an article is saved, with an allow-list of tags and attributes, and stores both. Links are `https` or `mailto` only, open in a new tab with `rel="noopener nofollow ugc"`. The public page and the widget show only the stored HTML.
- The dashboard editor is a textarea with a preview and a toolbar, using the same renderer. No rich-text dependency.
- **Images** are uploaded to R2 under the website, served from `/help-assets/<id>` with long cache headers, and limited in type and size as attachments are. They are not personal data and are not attachments of a conversation.

### Drafting articles with AI

- **Draft with AI** takes any of: the website, read from its sitemap or by following its links; specific links; and files. A supervisor chooses the language and, optionally, a collection.
- **Links and the website** follow the assistant's rules for reading pages ([ADR-0022](0022-ai-assistant.md), and [security](../security.md#the-ai-assistant)): `https` only, on the host of one of the website's allowed origins, no credentials or ports, at most 50 pages, size and time limits, redirects checked each hop. Material from other companies' sites is not read, so the help centre cannot be filled with copied content, and the installation is not a crawler for anyone's site.
- **Files**: PDF, Word (`.docx`), OpenDocument text (`.odt`), HTML, Markdown and plain text, at most 10 files of 10 MB each. PDF, Word, OpenDocument and HTML are converted to Markdown with Workers AI's `toMarkdown`, which is free for those formats. Images and spreadsheets are not accepted: images are converted by models, which costs, and spreadsheets rarely make articles. Files go to R2 only for the job, and are deleted when it ends, or within a day by a sweep if it fails.
- **The job** (`help.draft`, on the jobs queue) first asks the text model for an outline, at most 20 articles, each with a title, a summary, a collection and the material it comes from. Then it writes each article in Markdown from its material only. Each article is a separate model call, so one failure does not lose the rest, and a retry skips articles already written.
- **What it writes is a draft**, never published by itself. It is marked **Drafted by AI** with the pages and files it came from, until a person edits it. It goes through the same Markdown renderer and allow-list as any article, and links only to URLs that appear in its material, as the assistant's answers do.
- **The material is untrusted.** A page can contain instructions to the model. The model has no tools, its output is a draft a supervisor reviews, and the renderer allows no HTML, so the worst it can do is write a bad draft.
- **Personal data.** The material should be the company's own. The dialog says not to upload customer data, and the files are not kept.
- **Limits**: one drafting run at a time per website, a daily limit per workspace, at most 200,000 characters of material per run. Usage is counted with the assistant's.
- It needs Workers AI. Installations deployed without it, and Cloud until its privacy documents cover Workers AI, show the help centre without **Draft with AI**.

### Search

- **No FTS5**, because of backups. Each article stores `search_text`: its title, summary and body as plain text, lower-cased, with accents folded. Search splits the query into words (Latin scripts) or into overlapping two-character pieces (Chinese, Japanese, Korean), and matches with `LIKE` on articles published in that website and language, ranked by matches in the title, then the summary, then the body.
- That is a scan, so it is bounded: at most **1,000 articles per website** and **20,000 characters per article**. 1,000 articles of 20 KB is 20 MB for a website; this is checked on real D1 before the step ships, and the limit is lowered if it is slow.
- When the assistant is on, the widget can also search by meaning through the existing Vectorize index. That is a later improvement, not step 1.
- Queries are not stored. Counts of searches with no results are kept per day, without the words, so a supervisor knows something is missing.

### Data model

- `help_collections`: `workspace_id`, `website_id`, name, slug, position, per language.
- `help_articles`: `workspace_id`, `website_id`, `collection_id`, `translation_group_id`, `language`, `slug`, `title`, `summary`, `body_markdown`, `body_html`, `search_text`, `status`, `version`, `published_at`, `updated_by_member_id`, timestamps. Unique `(website_id, language, slug)`.
- `help_assets`: images, keyed to the website.
- `websites.help_slug`, nullable, unique per installation.
- `conversations.help_article_id`, nullable, the article a visitor came from.
- `help_draft_runs`: one per **Draft with AI**, with its inputs (links and file names, not the files), status, counts and error code. `help_articles.draft_run_id` and `ai_drafted` mark articles it wrote; editing clears `ai_drafted`.
- All new tables and columns; nothing is rebuilt. Reached only through a scoped `helpRepository`. The public routes look up the website by slug, and only ever read `published` rows.
- Publishing, unpublishing and deleting are audited.

### Public serving and caching

- Public pages and the widget's help API are rate-limited per IP like the widget API, and cached with the Cache API. The cache key includes the website's `help_version`, which every publish, unpublish or edit of a published article bumps, so a change shows at once and nothing stale is served for long.
- Pages carry `<link rel="canonical">`, a sitemap at `/help/<slug>/sitemap.xml`, and `noindex` for a website that asks for it.
- The page sets a strict Content Security Policy: no script except the optional widget loader, images only from the installation.

### Privacy and data

- Articles are the company's content, not visitor data. Contact export and erasure do not touch them. Retention does not delete them.
- The public page sets no cookies and stores nothing in the browser. Opening the widget from it behaves as the widget does on any page.

### Build order

1. **Articles and the public page.** Collections, the editor with preview, publish, the public page with search, images. Exit check: a supervisor publishes articles in two languages, and a visitor finds them by search on a real installation, including in Japanese.
2. **Drafting with AI.** From the website, links and files. Exit check on real Cloudflare: a website and a PDF become reviewable drafts in two languages, with no invented links.
3. **The widget.** The Help tab, article view, "Still need help?", the article recorded on the conversation, within the bundle budget.
4. **The assistant.** Published articles become a source; unpublishing removes their vectors.

## Consequences

- Companies can deflect common questions without the AI assistant, and the assistant gets better sources when it is on.
- A new public surface to secure, cache and keep within Workers' CPU limits.
- `LIKE` search is simpler than FTS5 and survives backups, but ranks less well and is bounded by article count. If a large customer needs more, an FTS5 table with an export step that drops and rebuilds it is the upgrade, in a new ADR.
- Another set of dashboard pages and widget strings to translate.

## Alternatives considered

- **FTS5.** Better ranking and fast at any size, but breaks D1 export, so every backup would need a drop-and-rebuild step that an operator can forget, and its tokenizer is poor for Chinese and Japanese.
- **Search only by meaning, through Vectorize.** Good for questions, poor for exact words, and it needs Workers AI and Vectorize, which the help centre should not require.
- **A rich-text editor (TipTap, Lexical).** Nicer to write in, but a large dependency, and its HTML still has to be sanitised. Markdown with a preview is enough for help articles, and keeps one renderer.
- **Help centre per workspace, not per website.** Fewer pages for a company with one site, but the widget, its colours and the assistant are per website, and a company with two brands needs two help centres.
- **Drafting from any link on the internet.** More convenient, but it would let the installation copy other sites into published pages and fetch any address on a supervisor's behalf. The owner can widen it later.
- **A separate static site.** Fast, but a second deployment for every installation, and the widget could not search it.
