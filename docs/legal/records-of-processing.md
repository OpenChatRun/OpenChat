# Records of processing: Orango Labs Ltd

> Version 2, in force from 19 December 2026, 30 days after it was published on 19 November 2026. Adopted by Orango Labs Ltd. Version 2 adds the Android app, and Google LLC, which delivers its notifications. Until then, [version 1](https://github.com/OpenChatRun/OpenChat/blob/53ad7d6/docs/legal/records-of-processing.md) applies.

Organisation: Orango Labs Ltd, 111 New Union Street, Coventry, England, CV1 2NT. Contact: privacy@openchat.run. We have not appointed a representative in the EU under Article 27 of the EU GDPR, relying on the exemption in Article 27(2) for occasional processing that is unlikely to result in a risk to people's rights.. ICO data protection fee: not yet paid, to be paid before launch, and its registration number added here. No data protection officer appointed.

Last reviewed: 17 November 2026

## A. As processor (Article 30(2))

| | Managed notification relay |
|---|---|
| Controllers | Each organisation operating an OpenChat installation connected to the relay. The list is the relay's `installations` table, and `pnpm ocp relay stats` gives the count |
| Categories of processing | Storing device registrations and subscriptions; delivering notifications through Apple's push service, and Google's for Android phones; recording delivery outcomes; erasing on request |
| Data | See [data processing agreement](data-processing-agreement.md#2-data-subjects-and-data) |
| Transfers | Cloudflare (global network, including the United States), Apple (United States), Google (United States). Mechanism: the EU–US Data Privacy Framework and its UK Extension, under which Cloudflare, Inc., Apple Inc. and Google LLC are certified, with their standard contractual clauses and the UK International Data Transfer Addendum as the fallback |
| Security | See [data processing agreement](data-processing-agreement.md#5-security-measures) |

## B. As controller (Article 30(1))

| Activity | Purpose and basis | Data subjects | Data | Recipients | Retention |
|---|---|---|---|---|---|
| Relay security and operations logs | Keeping the relay secure and working. Legitimate interests | Team members using the app; installation operators | Request metadata, which may include IP addresses; installation IDs; error codes. No content or tokens | Cloudflare | 7 days |
| Privacy, security and support correspondence | Answering requests sent to privacy@, security@ and support@openchat.run, and keeping a record of them. Legitimate interests | People who write to us | Name, email address, anything they write | Cloudflare (Email Routing), Google (the Gmail inbox they are forwarded to) | 2 years after the last message |
| Privacy and erasure requests | Meeting legal obligations | People making requests | Contact details, request content | Cloudflare (Email Routing), Google (Gmail) | 2 years after the request is closed |

## Not processed by Orango Labs Ltd

- The contents of any OpenChat installation: conversations, contacts, visitors, accounts. Each installation's operator runs it on their own infrastructure, and is its controller.
- Any analytics or crash reports from the app. It contains neither.

## Erasure procedures

| Request | Action |
|---|---|
| An installation leaves | Its admin uses **Disconnect and erase**, or we run `pnpm ocp relay erase --env <env> --installation <id>`. Both erase at once |
| One person, through their organisation | The organisation removes them in OpenChat, and the installation deletes their subscriptions at the relay |
| One person, directly to us | We ask them to sign out of the app, which removes their phone's subscriptions at once, or we ask for their organisation's installation and erase with it. |
| Backups | Cloudflare D1 point-in-time history keeps erased rows for up to 30 days, then drops them. We do not restore erased data |
