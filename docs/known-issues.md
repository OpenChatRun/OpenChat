# Known issues

What does not work yet, what has not been tested, and what still needs a decision, as of release 0.2.1 and the work after it. OpenChat is before 1.0. Each item links to where it is recorded in more detail.

To report a new problem, [open an issue](https://github.com/OrangoLabsLtd/OpenChat/issues/new). For a vulnerability, follow [SECURITY.md](../SECURITY.md) instead.

## Before you rely on it

- **No independent security review yet.** Two internal reviews were done ([M1a](architecture/security-review-m1a.md), [M1b](architecture/security-review-m1b.md)). An external one is planned before general release.
- **The self-hosting guide has been followed only by its author.** Its Cloudflare steps were run from a fresh clone on real Cloudflare, but nobody else has followed it end to end ([M5 exit check](plan/milestones.md#m5-exit-check)).
- **The legal texts were written without a lawyer.** Orango Labs Ltd adopted them as version 1 on 2026-11-17 ([legal](legal/README.md)).

## The iPhone app and push

- **The app and the relay are not open source** ([ADR-0019](architecture/decisions/0019-app-and-relay-leave-open-source.md)). A self-hoster uses the official app with the project's relay, and can no longer build a branded app or run their own relay from this repository.
- **The official app is not on the App Store yet.** Version 1.0.0 is waiting for Apple's review, sent on 18 November 2026. Until it is out, teams use the dashboard, and get no push notifications.
- **The project's relay is open to any installation that proves control of its domain**, within [limits](notification-relay/protocol.md#rate-limits). Using it means accepting its [terms](legal/relay-terms.md).
- **Tested on one iPhone.** Several devices, a token change, and signing out while offline were not tried on real phones ([M2](plan/milestones.md#m2-exit-check), [M3](plan/milestones.md#m3-exit-check)).
- **Push text is in English.** There are no notifications for a transfer as such (it arrives as an assignment), or for other changes to a conversation.
- **A phone stays subscribed while any of its sessions lasts**, so ending one session does not stop that phone's notifications.
- **Not built:** rotating an installation's relay signing key, and alerts on failed deliveries.
- **The app holds one installation at a time** ([ADR-0014](architecture/decisions/0014-one-installation-in-the-app.md)). To use a second installation, you sign out of the first, and notifications from the first stop. The original brief asked for both at once ([M6 exit check](plan/milestones.md#m6-exit-check)).

## The AI assistant

- **All three steps of [ADR-0022](architecture/decisions/0022-ai-assistant.md) are built:** sources, answering visitors, and learning from resolved conversations.
- **The check for personal data in learned answers uses patterns and names.** It can miss a name spelt differently, or a detail with no pattern, such as a street address. Review before approving, and keep approval on until you trust it.
- **Learning can ask the model twice** for one conversation changed twice in the same moment; only one answer is kept, but both count towards the daily limit.
- **The iPhone and Android apps label its messages from their next release.** Until then they show its answers as if a visitor wrote them. The dashboard and widget label them AI.
- **A rare missed push.** A visitor's message is not pushed while the assistant answers. If its job fails three times, or the assistant is turned off at that moment, that message gets no push; the conversation still shows in the inbox.
- **Spotting a request for a person, or an attempt to steer it, uses word lists.** Other phrasings reach the model, which is told to decline.
- **Its widget text was machine-translated**, and needs a native speaker's review.
- **Not offered on OpenChat Cloud** until its privacy documents cover Workers AI.
- **It can be wrong.** The threshold for a relevant passage, 0.45, was set from one website in four languages ([validation](architecture/cloudflare-validation.md#ai-assistant-sources-on-real-cloudflare-2026-11-19)).
- **Changes take up to a minute to show**, because Vectorize applies writes in the background.
- **Its dashboard text was machine-translated**, like the rest.

## The help centre

- **Steps 1 to 3 of [ADR-0023](architecture/decisions/0023-help-centre.md) are built:** articles, collections, images, the public pages with search, Draft with AI, and the widget's Help tab. The AI assistant answering from articles is the next step.
- **The widget's Help tab lists articles in order, not the most read,** because views are not counted. It appears up to 30 seconds after the first article is published.
- **Only the first conversation records the article.** Still need help? from an article, when the visitor already has a conversation, takes them back to it without noting the article.
- **Draft with AI can be wrong.** It writes from the material only, but a model can still misread it. Every article is a draft for a person to check.
- **Draft with AI reads the website from its first allowed origin's home page**, following links, as the assistant does. It does not read a sitemap, and it reads at most 50 pages.
- **Scanned PDFs** have no text for it to read, and images in files are ignored.
- **Drafted titles can read poorly** in some languages, such as Japanese titles ending "…について?". Edit them before publishing.
- **Search matches words, not meaning.** It ranks by where the words appear, and every word must be there, so "refund" does not find "money back".
- **Only on the installation's own address**, `/help/<slug>`. A custom domain such as `help.example.com` is not offered.
- **Images are public at their link**, including those used only in drafts, though the link cannot be guessed.
- **Its text was machine-translated**, on the public pages and in the dashboard.
- **Changing an address breaks the old links**, with no redirect.

## The widget

- **One conversation per visitor.** The widget shows one, though the API allows more.
- **No native SDK for mobile apps.** An app shows the widget from a chat page on the company's site, in a web view, and is not told about new replies ([widget guide](guide/widget.md#in-a-mobile-app)).
- **"We are online" counts open dashboards and app screens only.** An agent who answers from a notification shows as away until the app is open, and an open widget does not see the change until it loads again ([realtime](architecture/realtime.md)).
- **"Before the first message" email is enforced only by the widget**, not by the API.
- **Translations have not been reviewed by native speakers** in the widget, the dashboard or the app ([widget](architecture/widget.md#languages), [dashboard](architecture/dashboard.md#languages)). Right-to-left languages, such as Arabic and Hebrew, are not supported.
- **No screen-reader user has reviewed it.** It passes automated checks and was checked by hand ([accessibility](architecture/accessibility.md)).
- **Its focus ring uses the website's colour**, so a very light colour can make it hard to see on a light page.
- **Tested in Chromium only** on real Cloudflare.

## The inbox and dashboard

- **No contact list, and no merging of contacts.** A visitor who writes from two browsers is two contacts.
- **No search.** Planned with M7.
- **Server messages stay in English** in the dashboard, such as errors, though its own words are in eleven languages ([languages](architecture/dashboard.md#languages)).
- **A visitor's read position is not shown**, though it is recorded.
- **No canned responses.**

## Email

- **Two uses only:** follow-ups to visitors, and account emails to colleagues. No alerts to members, transcripts, or summaries ([M4](plan/milestones.md#m4-exit-check)).
- **One fixed follow-up template**, which cannot be edited per workspace.
- **A new rule, or a shorter wait, applies to a conversation only after its next public message.**
- **Gmail did not show its own Unsubscribe button.** The link in the email works.
- **Bounces and complaints are not received from the provider.** Cloudflare refuses those addresses itself, but they do not appear in **Addresses not to email**.
- **Rarely, an email can be sent twice, or not at all,** if a failure falls between sending and recording it. Cloudflare's email service documents no way to prevent this.

## Data and operations

- **An installation made with the Deploy to Cloudflare button has no `oc` commands**, and no way to reset a password without email ([one-click deploy](operations/one-click-deploy.md#what-you-do-not-get)).
- **Nothing caps total stored data** for a website, and there is no daily limit on files ([security review](architecture/security-review-m1b.md#gaps-to-close-later)).
- **A former colleague's name cannot be erased.** Accounts can be deactivated, and their messages keep their name.
- **A restore does not bring back files**, which are not in a backup, and **a contact erased after the restore point comes back**, so erase them again. Other limits apply ([backup and restore](operations/backup-and-restore.md#what-a-restore-does-not-put-back)).
- **Removing an installation does not empty its file bucket.** Wrangler cannot; empty it in the Cloudflare dashboard first.
- **About 5% of 1,000 open connections closed during a deploy** in the load test, and reconnected only when their clients retried. Messages were not lost ([M1b](plan/milestones.md#m1b-exit-check)).
- **The installation's release version is public**, in its discovery document, because the AGPL source offer needs it ([licensing](operations/licensing.md#the-source-offer)).

## Throughput

Measured once, from one machine: about 45 messages a second with p95 latency under one second, and 1,000 connections reconnecting. What sets the ceiling is not known. Choose a database location near your team and visitors, because latency depends on it ([M1b](plan/milestones.md#m1b-exit-check)).
