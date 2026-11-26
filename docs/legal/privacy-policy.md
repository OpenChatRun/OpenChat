# Privacy policy: OpenChat app and managed relay

> Version 2, published on 19 November 2026 and in force from 20 November 2026, when the Android app was released. Adopted by Orango Labs Ltd. Version 2 adds the Android app, and Google LLC, which delivers its notifications. Before that, [version 1](https://github.com/OpenChatRun/OpenChat/blob/53ad7d6/docs/legal/privacy-policy.md) applied.

Effective: 20 November 2026

## Who we are

Orango Labs Ltd, company number 17102914, registered at 111 New Union Street, Coventry, England, CV1 2NT ("we"). Contact for anything in this policy: privacy@openchat.run. We have not appointed a representative in the EU under Article 27 of the EU GDPR, relying on the exemption in Article 27(2) for occasional processing that is unlikely to result in a risk to people's rights.

We publish the OpenChat app for iPhone and Android ("the app"), and run a notification relay ("the relay") at `openchat-relay.orangolabs.com`. The relay sends push notifications to the app for OpenChat installations that use it.

## What this policy does not cover

OpenChat is open-source software that organisations run for themselves. **Your conversations, your account, and everything your organisation's OpenChat holds are run by that organisation, not by us.** It is the controller of that data, and its own privacy notice applies. We cannot see it.

The app connects directly to the OpenChat address you enter. Your messages, your email address and your password go only there, never to us.

## What reaches us, and why

Only what is needed to deliver a push notification to your phone reaches the relay. The notification itself, including the message text, is **encrypted by your organisation's OpenChat for your phone alone**. Only your phone holds the key. We cannot read it, and neither can Apple or Google. **We receive no readable message text, no names, no email addresses, and nothing about the website visitors you talk to.**

| Data | Where it comes from | Why |
|---|---|---|
| Your phone's push token from Apple (iPhone) or Google (Android), stored encrypted | The app, when you allow notifications | To address notifications to your phone |
| An ID and secret for your phone, the app's bundle ID or package name, and its push environment | The app | To recognise your phone again |
| An ID your organisation gives you, which is not your user account, name or email | Your organisation's OpenChat | To send a notification to the right person |
| Your organisation's installation ID, web address and public key, plus an ID for each workspace | Your organisation's OpenChat | To check that requests really come from it |
| For each notification: its ID, the event type (such as "new message"), a conversation ID, and whether it was delivered | Your organisation's OpenChat, and Apple or Google | To deliver it once, and to see delivery problems |
| For each notification: the encrypted notification for each of your phones, which we cannot read | Your organisation's OpenChat | To pass it to Apple or Google. We never store or log it |
| Request metadata, which may include an IP address | Our hosting provider's logs | To keep the relay secure and running |

Your phone decrypts the notification and shows the workspace name, the sender, and the start of the message. If it cannot, it shows a fixed phrase such as "New message". To hide message text on your lock screen, use **Show Previews** in iOS Settings > Notifications. On Android, turn off sensitive notifications on the lock screen in Settings > Notifications.

## Our role, and the legal basis

For the relay data in the table above, **your organisation is the controller** and we process it on its behalf, under a data processing agreement. Questions about why it is used, or requests to see or erase it, are best sent to your organisation. We will help it answer them.

We are the controller for:
- security and operational logs, under our legitimate interest in running a secure service;
- privacy, security and support correspondence, under our legitimate interest in answering it and keeping a record of what we were asked.

## How long we keep it

| Data | Kept |
|---|---|
| Notification records | 30 days |
| Your phone's record | Until you sign out of every workspace and do not sign in again for 7 days, until Apple or Google tells us the token is no longer valid, or until your organisation stops using the relay |
| Your organisation's installation and workspace records | Until it disconnects from the relay or asks us to erase them |
| Hosting provider logs | 7 days |
| Short-lived counters against abuse | 10 minutes |

When your organisation disconnects from the relay, we erase its records, and every phone record left without a subscription, straight away. Our database host keeps point-in-time recovery history for 30 days, so erased records are fully gone 30 days after erasure.

## Who else handles it

- **Cloudflare, Inc.** hosts the relay, its database and its logs.
- **Apple Inc.** delivers the notifications to iPhones.
- **Google LLC** delivers the notifications to Android phones, through Firebase Cloud Messaging.

The current list is in [Subprocessors](subprocessors.md). They operate outside the UK and EU, including in the United States. Transfers rely on the EU–US Data Privacy Framework and its UK Extension, under which Cloudflare, Inc., Apple Inc. and Google LLC are certified, with their standard contractual clauses and the UK International Data Transfer Addendum as the fallback.

We do not sell data, show advertising, or use analytics or crash reporting in the app.

## Security

Push tokens are encrypted at rest. Phone secrets are stored only as hashes. Every request from an organisation's OpenChat is signed with its own key, and no organisation can see another's data. The relay never receives readable message content: notifications are encrypted for each phone with a key only that phone holds.

## Your rights

Under UK and EU data protection law, you may ask to access, correct or erase your data, to restrict or object to its use, and to receive it in a portable form. To stop all notifications at once, turn notifications off for the app in your phone's settings, or sign out of the app. For anything else, contact your organisation, or us at privacy@openchat.run. We answer within one month.

You may also complain to the UK Information Commissioner's Office (ico.org.uk), or to the data protection authority where you live.

## Children

The app and the relay are business tools for an organisation's team. They are not meant for anyone under 16, and we do not knowingly process their data.

## Changes

We will post changes here, and record the date above. For a significant change, we will announce it in the release notes in advance. The relay holds no contact details for organisations, so we cannot write to them.
