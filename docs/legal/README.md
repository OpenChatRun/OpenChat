# Legal documents for the managed relay

> **Version 1, in force from 17 November 2026, adopted by Orango Labs Ltd** (company 17102914), which owns this repository and runs the managed relay, the app and the website. They were written without a lawyer, and the owner adopted them as they are. A lawyer's review is still worth having, and the decisions below are where to start.

These cover the **managed relay** (`openchat-relay.orangolabs.com`) and the **official app** for iPhone and Android, all run by Orango Labs Ltd. They do not cover a self-hosted installation. Whoever runs an installation is the controller of everything in it, and needs their own privacy notice for their visitors and team.

| Document | For | Status |
|---|---|---|
| [Privacy policy](privacy-policy.md) | People using the official app, and anyone whose data reaches the managed relay | Draft |
| [Relay terms](relay-terms.md) | Operators of installations that use the managed relay | Draft |
| [Data processing agreement](data-processing-agreement.md) | The same operators, under Article 28 GDPR | Draft |
| [Records of processing](records-of-processing.md) | Orango Labs Ltd internally, under Article 30 | Draft |
| [Subprocessors](subprocessors.md) | Published, and referenced by the agreement | Draft |

## Version 2

Published on 19 November 2026, and in force from 20 November 2026. It adds the Android app ([ADR-0021](../architecture/decisions/0021-android-app-and-fcm.md)), and Google LLC, whose Firebase Cloud Messaging delivers notifications to Android phones. Google can no more read them than Apple can. Nothing else changes.

Version 2 was first published as in force from 19 December 2026, 30 days later, as the notice rule below asks for a new subprocessor. The Android app was released on Google Play on 20 November 2026, and Google has delivered its notifications from that day, so the notice given was one day and not 30. On 26 November 2026 the owner decided that the documents should say what happened. Only people who install the Android app are affected: an installation whose team uses no Android phone sends nothing to Google. An operator who objects can disconnect from the relay, which erases what it holds.

## Contact

privacy@openchat.run, security@openchat.run and support@openchat.run are routed by Cloudflare Email Routing to the Orango Labs Gmail inbox. Google is therefore a recipient of that correspondence.

## Decisions taken in version 1

| Question | Decision |
|---|---|
| Who we are | Orango Labs Ltd, 17102914, 111 New Union Street, Coventry, CV1 2NT. It owns the code (the repository moved to `OrangoLabsLtd/OpenChat` on 2026-11-17, and is now `OpenChatRun/OpenChat`) and runs the services |
| Law | England and Wales |
| Roles | The operator is the controller of its team's relay data, and Orango Labs its processor. Orango Labs is the controller of its own security logs and correspondence |
| Transfers | EU–US Data Privacy Framework and its UK Extension (Cloudflare, Apple and Google are certified), with their standard contractual clauses and the UK Addendum as the fallback |
| Cloudflare logs | Treated as holding IP addresses, kept 7 days |
| D1 Time Travel | Disclosed: erased rows are gone after 30 days, and are never restored |
| Encrypted notifications | Treated as personal data in our hands, though we cannot read them |
| EU representative | None, relying on Article 27(2). Appoint one when EU customers become a regular part of the business, which the SaaS version may bring about |
| Liability | Capped at the greater of £100 and what was paid in 12 months |
| Children | Not meant for anyone under 16 |
| Accepting the relay terms | Using the managed relay means accepting them. The dashboard says so next to push notifications, with a link |
| Notice of changes | Published here and in the release notes, 30 days ahead for a material change or a new subprocessor. The relay holds no operator contacts |
| Correspondence | privacy@, security@ and support@openchat.run, kept 2 years after the last message |
| Safe harbour | As written in [SECURITY.md](../../SECURITY.md#research-in-good-faith), given by Orango Labs Ltd |

## Still to do

- **Pay the ICO data protection fee**, and add the registration number to the [records](records-of-processing.md). No entry was found on the ICO register on 2026-11-17.
- **Turn on two-factor authentication** on the Cloudflare account and require it in the `OpenChatRun` GitHub organisation. The [agreement](data-processing-agreement.md#5-security-measures) promises it, and neither was on.

## How the documents match the code

Each claim about data, retention or erasure comes from the [relay protocol](../notification-relay/protocol.md#relay-data), its [erasure section](../notification-relay/protocol.md#6-erasure), and [Cloudflare validation](../architecture/cloudflare-validation.md). If the code changes, update these documents in the same change.
