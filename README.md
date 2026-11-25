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
  <a href="docs/guide/README.md">User guide</a> ·
  <a href="docs/known-issues.md">Known issues</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-before%201.0-0a57f5" alt="Status: before 1.0">
  <img src="https://img.shields.io/badge/server-AGPL--3.0-15296e" alt="Server licence: AGPL-3.0-or-later">
  <img src="https://img.shields.io/badge/widget%20%26%20app-Apache--2.0-15296e" alt="Widget and app licence: Apache-2.0">
  <img src="https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-18a0fb" alt="Runs on Cloudflare Workers">
  <img src="https://img.shields.io/badge/iPhone%20app-coming%20soon%20to%20the%20App%20Store-0a57f5" alt="iPhone app: coming soon to the App Store">
</p>

<p align="center">
  <img src="docs/assets/screenshots/inbox.png" width="72%" alt="The team inbox: a navy side rail, the list of conversations, an open conversation, and the visitor's details">
  &nbsp;
  <img src="docs/assets/screenshots/widget.png" width="24%" alt="The website widget, open, with a visitor's question and the team's answer">
</p>

A chat button for your website, a team inbox on the web and on iPhone, and follow-up emails to visitors who go quiet. Each company runs its own installation, so its conversations stay in its own account.

- **Website widget.** About 2 KB to load, in eleven languages, with optional consent mode and Cloudflare Turnstile.
- **Team inbox.** In the same eleven languages. Live replies, internal notes, files, statuses, priorities, assignment and tags, across several workspaces.
- **The OpenChat iPhone app**, coming soon to the App Store, with notifications end-to-end encrypted to each phone, so the relay that carries them cannot read them. The app and the relay are not open source, but your installation works with them.
- **Follow-up emails**, only with the visitor's consent, with an unsubscribe link.
- **An AI assistant that answers first**, if you turn it on. It answers visitors from your website's pages and texts you give it, and from answers it learns from your team's resolved conversations once a supervisor approves them. It hands over to a person when it cannot answer, or the visitor asks for one, and every answer is labelled AI. It runs on Workers AI in your own Cloudflare account. Not yet on OpenChat Cloud.
- **For operators:** one-command deploy and upgrade with rollback, backups, health checks, retention, data export and erasure, and an audit log.

**Status: before 1.0.** It works, and has been tested on real Cloudflare, but has not had an independent security review, and the official iPhone app is waiting for Apple's review. Read the [known issues](docs/known-issues.md) before relying on it.

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

## Roadmap

**Coming soon**

- **The iPhone app on the App Store.** Version 1.0.0 was sent to Apple for review on 18 November 2026. Like the dashboard, it speaks eleven languages.
- **The Android app on Google Play**, with the same inbox and end-to-end encrypted notifications as the iPhone app. It is in internal testing, and will be public from 19 December 2026 at the earliest.

**Planned.** These have no dates yet, and each gets a design before it is built.

- **A help centre:** articles your visitors can search from the widget and a public page, which the AI assistant also answers from.
- **Automatic translation.** Visitors write in their own language and agents in theirs; each side sees the conversation translated, with the original one tap away.
- **More languages**, including right-to-left ones such as Arabic and Hebrew.
- **WhatsApp.** Customers write to your WhatsApp Business number, and the conversation arrives in the same inbox as website chats, with the same assignment, notes and tags.
- **More channels in the same inbox:** email to a support address, Facebook Messenger, Instagram and Telegram.
- **Saved replies**, for answers your team gives often.
- **Business hours**, with an away message and a form for leaving an email outside them.
- **Routing:** teams, and rules that assign new conversations automatically, such as by website, language or turn.
- **Ratings and reports:** visitors rate a conversation once it is resolved, and supervisors see volume, first-response and resolution times.
- **Webhooks and integrations**, so that other tools, such as Slack or a CRM, hear about new conversations and messages.

Ideas and requests are welcome in [issues](https://github.com/OrangoLabsLtd/OpenChat/issues).

## Licence

The server, dashboard and CLI are under AGPL-3.0-or-later. The widget and the client libraries are under Apache-2.0. The iPhone app and the notification relay are not open source ([ADR-0019](docs/architecture/decisions/0019-app-and-relay-leave-open-source.md)); this repository has the server's side of push. See [LICENSE](LICENSE) and [licensing](docs/operations/licensing.md). The original brief is in [REQUIREMENTS.md](REQUIREMENTS.md).
