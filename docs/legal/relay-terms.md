# Terms of use: OpenChat managed relay

> Version 2, published on 19 November 2026 and in force from 20 November 2026, when the Android app was released. Adopted by Orango Labs Ltd. Version 2 adds the Android app, and Google LLC, which delivers its notifications. Before that, [version 1](https://github.com/OpenChatRun/OpenChat/blob/53ad7d6/docs/legal/relay-terms.md) applied.

Effective: 20 November 2026

These terms are between Orango Labs Ltd, company number 17102914, registered at 111 New Union Street, Coventry, England, CV1 2NT ("we"), and the organisation that operates an OpenChat installation and connects it to the relay at `openchat-relay.orangolabs.com` ("you").

## 1. The service

The relay sends push notifications from your OpenChat installation to the official OpenChat iOS app. It works only with that app. For your own app, run your own relay. The open-source code includes one.

The relay is offered free of charge, as is, with no service level. Notifications are a convenience: messages always reach the app when it is open, whether or not the relay is working.

## 2. Access

Any installation that proves control of its domain may register, within the limits we publish. We may refuse or end access at our discretion. Where we can, we will give notice and a reason.

## 3. Your responsibilities

You will:
- use the relay only to notify your own team members about your own OpenChat conversations;
- keep your installation's signing key secret, and tell us promptly if it is exposed;
- give your team the privacy information the law requires, including that notifications pass through the relay;
- not try to send content, personal data or anything other than what the [relay protocol](../notification-relay/protocol.md) defines. The relay refuses unknown fields;
- not overload, probe or disrupt the relay, or try to reach another installation's data.

## 4. Data protection

You are the controller of the personal data your installation and your team's phones send to the relay. We process it as your processor under the [data processing agreement](data-processing-agreement.md), which forms part of these terms. The [privacy policy](privacy-policy.md) describes what the relay holds and for how long.

## 5. Limits and suspension

The relay applies rate limits per installation and per recipient. We may change them to protect the service. We may suspend an installation immediately if it threatens the relay's security, its availability for others, or Apple's or Google's terms for push notifications.

## 6. Leaving

You may stop at any time. As an installation admin, in your dashboard choose **Workspaces**, **Push notifications**, **Disconnect and erase**. The relay then erases everything it holds about your installation straight away. If you cannot do that, email privacy@openchat.run and we will erase it for you. If we end your access, we erase your data within 30 days.

## 7. Liability

To the extent the law allows, we are not liable for indirect or consequential loss, or for notifications that are lost or delayed. Our total liability under these terms is limited to the greater of £100 and the amounts you paid us for the relay in the 12 months before the claim. The relay is free, so in practice £100. Nothing here limits liability that cannot be limited by law.

## 8. Changes

We may change these terms, with at least 30 days' notice of a material change, by publishing them here and announcing them in the release notes. The relay holds no contact details for you. If you do not agree, you may disconnect before the change takes effect.

## 9. Law

These terms are governed by the law of England and Wales, and its courts have exclusive jurisdiction.
