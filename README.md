<p align="center">
  <img src="docs/assets/brand/openchat-mark-512.png" width="128" height="128" alt="The OpenChat icon, a blue cube with two eyes">
</p>

<h1 align="center">OpenChat</h1>

<p align="center">
  <strong>Your chat. Your cloud.</strong><br>
  Open-source customer chat that runs entirely in your own Cloudflare account.
</p>

<p align="center">
  <a href="https://openchat.run">Website</a> ·
  <a href="docs/operations/self-hosting.md">Self-host</a> ·
  <a href="#why-cloudflare">Why Cloudflare</a> ·
  <a href="#how-it-compares">Compare</a> ·
  <a href="docs/guide/README.md">User guide</a> ·
  <a href="docs/known-issues.md">Known issues</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-before%201.0-0a57f5" alt="Status: before 1.0">
  <img src="https://img.shields.io/badge/server-AGPL--3.0-15296e" alt="Server licence: AGPL-3.0-or-later">
  <img src="https://img.shields.io/badge/widget%20%26%20app-Apache--2.0-15296e" alt="Widget and app licence: Apache-2.0">
  <img src="https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-18a0fb" alt="Runs on Cloudflare Workers">
  <img src="https://img.shields.io/badge/apps-iPhone%20%26%20Android-0a57f5" alt="Apps: iPhone and Android">
</p>

<p align="center">
  <img src="docs/assets/screenshots/inbox.png" width="72%" alt="The team inbox: a navy side rail, the list of conversations, an open conversation, and the visitor's details">
  &nbsp;
  <img src="docs/assets/screenshots/widget.png" width="24%" alt="The website widget, open, with a visitor's question and the team's answer">
</p>

A chat button for your website, a team inbox on the web, iPhone and Android, and follow-up emails to visitors who go quiet. Each company runs its own installation, so its conversations stay in its own account.

- **Website widget.** About 2 KB to load, in eleven languages, with optional consent mode and Cloudflare Turnstile.
- **Team inbox.** In the same eleven languages. Live replies, internal notes, files, statuses, priorities, assignment and tags, across several workspaces.
- **The OpenChat app** for [iPhone](https://apps.apple.com/app/id6833420293) and [Android](https://play.google.com/store/apps/details?id=com.orangolabs.openchat), with notifications end-to-end encrypted to each phone, so the relay that carries them cannot read them. The app and the relay are not open source, but your installation works with them.
- **Follow-up emails**, only with the visitor's consent, with an unsubscribe link.
- **An AI assistant that answers first**, if you turn it on. It answers visitors from your website's pages and texts you give it, and from answers it learns from your team's resolved conversations once a supervisor approves them. It hands over to a person when it cannot answer, or the visitor asks for one, and every answer is labelled AI. It runs on Workers AI in your own Cloudflare account. Not yet on OpenChat Cloud.
- **A help centre**: articles your visitors read and search on a public page and in the widget, with views and "Was this helpful?" counts. The AI assistant answers from them too.
- **Automatic translation**, if you turn it on. Visitors write in their language and your team in theirs, with the original one tap away. It needs Workers AI, so it is not yet on OpenChat Cloud.
- **Saved replies, opening hours, chat ratings, contacts and analytics.**
- **For operators:** one-command deploy and upgrade with rollback, backups, health checks, retention, data export and erasure, and an audit log.

**Status: before 1.0.** It works, and has been tested on real Cloudflare, but has not had an independent security review. Read the [known issues](docs/known-issues.md) before relying on it.

## Start

| You want to | Read |
|---|---|
| Try it in your own Cloudflare account, without a terminal | [Deploy with one click](docs/operations/one-click-deploy.md) |
| Run it for your company | [Self-hosting guide](docs/operations/self-hosting.md) |
| Have an AI agent install it for you | [Set up with an AI agent](docs/operations/agent-setup.md) |
| Use it: answer chats, administer it, add the widget | [User guide](docs/guide/README.md) |
| Know what is not done yet | [Known issues](docs/known-issues.md) |
| Understand how it works, or contribute | [Documentation index](docs/README.md), [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md) |
| Use the icon, or match the colours | [Design system](docs/architecture/design-system.md) |
| Report a vulnerability | [SECURITY.md](SECURITY.md), privately |

## Why Cloudflare

OpenChat is built for Cloudflare only. It does not run on your own server or on another cloud. That is a deliberate trade, and this is what it buys:

- **No servers to look after.** An installation is one Worker with a D1 database, an R2 bucket for files, Durable Objects for live connections and Queues for background jobs. There is no operating system to patch, no database server to tune and no Redis to keep alive.
- **A small bill that follows use.** The supported minimum is the [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/), US$5 a month when this was written, which includes a large allowance. Beyond it you pay Cloudflare for what you use. There is no fee per seat, per conversation or per website.
- **Quiet visitors cost almost nothing.** Durable Objects hibernate while a WebSocket stays open, so visitors with the widget open and nothing to say do not keep a server busy. The widget opens no connection at all until a conversation exists.
- **One account holds everything.** Conversations, files, email, and the AI assistant on Workers AI all run in the same Cloudflare account. Turning on the assistant or translation adds no second vendor that sees your visitors' messages.
- **Fast for visitors everywhere.** The widget and the API are served from Cloudflare's network, near each visitor. The database lives in one location, which you choose when you deploy.
- **Deploys are one command.** `pnpm oc deploy` creates every resource, and an upgrade can be rolled back. There is also a [deploy button](docs/operations/one-click-deploy.md) that needs no terminal.

What it costs you: you depend on one provider, a D1 database holds at most 10 GB, and the free Workers plan is not enough. The limits we checked are in [Cloudflare validation](docs/architecture/cloudflare-validation.md).

## How it compares

A summary, checked in November 2026. Prices and plans change, so check each product's own pages.

| | OpenChat | [Chatwoot](https://www.chatwoot.com), self-hosted | [Tidio](https://www.tidio.com) | [Intercom](https://www.intercom.com) | [Crisp](https://crisp.chat) |
|---|---|---|---|---|---|
| **Source** | Open: server AGPL-3.0, widget Apache-2.0. The apps and relay are closed | Open: MIT, with some features under a paid Enterprise licence | Closed | Closed | Closed |
| **Where conversations are kept** | Your Cloudflare account | Your servers | Tidio's | Intercom's | Crisp's |
| **What you run** | One Worker. No servers | A Rails app, background workers, PostgreSQL and Redis | Nothing | Nothing | Nothing |
| **What you pay for** | Cloudflare, by use. No fee per seat | Your servers, and a paid plan for Enterprise features | A plan sized by conversations, with the AI priced separately | Each seat, and each conversation the AI resolves | Each workspace, with a set number of seats |
| **AI that answers first** | Yes, on Workers AI in your own account | Yes, in the Enterprise edition | Yes | Yes | Yes |
| **Channels** | Website chat | Website chat, email, WhatsApp, social networks and more | The same | The same, and phone | The same |
| **Maturity** | Before 1.0, no independent security review | Established | Established | Established | Established |

**Choose OpenChat** if you want your conversations in an account you own, a bill that does not grow with your team, and nothing to maintain.

**Choose something else** if you need WhatsApp, email or social channels in the same inbox today (they are on the [roadmap](#roadmap)), if you must run on your own servers or another cloud (Chatwoot does), or if you need a vendor with security certifications.

## Roadmap

**Planned.** These have no dates yet, and each gets a design before it is built.

- **More languages**, including right-to-left ones such as Arabic and Hebrew.
- **WhatsApp.** Customers write to your WhatsApp Business number, and the conversation arrives in the same inbox as website chats, with the same assignment, notes and tags.
- **More channels in the same inbox:** email to a support address, Facebook Messenger, Instagram and Telegram.
- **Routing:** teams, and rules that assign new conversations automatically, such as by website, language or turn.
- **Webhooks and integrations**, so that other tools, such as Slack or a CRM, hear about new conversations and messages.

Ideas and requests are welcome in [issues](https://github.com/OrangoLabsLtd/OpenChat/issues).

## Licence

The server, dashboard and CLI are under AGPL-3.0-or-later. The widget and the client libraries are under Apache-2.0. The iPhone and Android apps and the notification relay are not open source ([ADR-0019](docs/architecture/decisions/0019-app-and-relay-leave-open-source.md)); this repository has the server's side of push. See [LICENSE](LICENSE) and [licensing](docs/operations/licensing.md). The original brief is in [REQUIREMENTS.md](REQUIREMENTS.md).
