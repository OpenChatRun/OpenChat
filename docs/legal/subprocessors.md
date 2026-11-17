# Subprocessors: OpenChat managed relay

> Version 1, in force from 17 November 2026. Adopted by Orango Labs Ltd.

Last updated: 17 November 2026

| Subprocessor | What it does | Data | Location | Transfer basis |
|---|---|---|---|---|
| Cloudflare, Inc. | Hosts the relay: Workers, D1 database, Queues, Durable Objects, and logs | Everything the relay holds. See the [privacy policy](privacy-policy.md#what-reaches-us-and-why) | Global network, including the United States | the EU–US Data Privacy Framework and its UK Extension, under which Cloudflare, Inc. and Apple Inc. are certified, with their standard contractual clauses and the UK International Data Transfer Addendum as the fallback |
| Apple Inc. | Apple Push Notification service, which delivers each notification to the phone | The push token, the encrypted notification, a fixed fallback phrase key, and opaque IDs in the payload. Apple cannot decrypt the notification | United States | the EU–US Data Privacy Framework and its UK Extension, under which Cloudflare, Inc. and Apple Inc. are certified, with their standard contractual clauses and the UK International Data Transfer Addendum as the fallback |

Apple is used because it is the only way to send a notification to an iPhone app.

We will update this page, and announce the change in the release notes, at least 30 days before adding or replacing a subprocessor. The relay holds no contact details for operators, so we cannot email them.
