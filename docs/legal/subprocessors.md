# Subprocessors: OpenChat managed relay

> Version 2, published on 19 November 2026 and in force from 20 November 2026, when the Android app was released. Adopted by Orango Labs Ltd. Version 2 adds the Android app, and Google LLC, which delivers its notifications. Before that, [version 1](https://github.com/OpenChatRun/OpenChat/blob/53ad7d6/docs/legal/subprocessors.md) applied.

Last updated: 19 November 2026

| Subprocessor | What it does | Data | Location | Transfer basis |
|---|---|---|---|---|
| Cloudflare, Inc. | Hosts the relay: Workers, D1 database, Queues, Durable Objects, and logs | Everything the relay holds. See the [privacy policy](privacy-policy.md#what-reaches-us-and-why) | Global network, including the United States | the EU–US Data Privacy Framework and its UK Extension, under which Cloudflare, Inc., Apple Inc. and Google LLC are certified, with their standard contractual clauses and the UK International Data Transfer Addendum as the fallback |
| Apple Inc. | Apple Push Notification service, which delivers each notification to the phone | The push token, the encrypted notification, a fixed fallback phrase key, and opaque IDs in the payload. Apple cannot decrypt the notification | United States | the EU–US Data Privacy Framework and its UK Extension, under which Cloudflare, Inc., Apple Inc. and Google LLC are certified, with their standard contractual clauses and the UK International Data Transfer Addendum as the fallback |
| Google LLC, from 20 November 2026 | Firebase Cloud Messaging, which delivers each notification to an Android phone | The push token, the encrypted notification, and opaque IDs in the message. Google cannot decrypt the notification | United States | the EU–US Data Privacy Framework and its UK Extension, under which Cloudflare, Inc., Apple Inc. and Google LLC are certified, with their standard contractual clauses and the UK International Data Transfer Addendum as the fallback |

Apple is used because it is the only way to send a notification to an iPhone app, and Google because it is the only way to wake an Android app reliably to receive one. Google LLC was announced on 19 November 2026, and has been used from 20 November 2026, when the Android app was released. That was sooner than the 30 days below.

We will update this page, and announce the change in the release notes, at least 30 days before adding or replacing a subprocessor. The relay holds no contact details for operators, so we cannot email them.
