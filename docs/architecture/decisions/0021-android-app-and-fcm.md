# ADR-0021: An Android app, with encrypted notifications through FCM

**Status:** Accepted, 2026-11-19, by the owner. Extends [ADR-0006](0006-apns-transport.md) with a second transport, and [ADR-0017](0017-encrypted-notifications.md) to a second kind of phone. Changes AGENTS.md rule 9 from "APNs tokens" to "push tokens (APNs or FCM)".

## Context

The roadmap promises an Android app "with the same inbox and end-to-end encrypted notifications as the iPhone app". The app is built with Expo and React Native ([ADR-0012](0012-native-builds-without-eas.md)), so its screens mostly run on Android as they are. What does not carry over is push:

- Android phones receive pushes through Firebase Cloud Messaging (FCM), not APNs. The relay speaks only APNs.
- On iOS, a Notification Service Extension decrypts each notification before it is shown (ADR-0017). Android has no extension. Instead, an app can receive a **data-only** FCM message in its own messaging service, and post the notification itself.
- The relay, its protocol and the installation all say `platform: 'ios'`.

The app and the relay live in the project's private repository ([ADR-0019](0019-app-and-relay-leave-open-source.md)). The protocol, the installation's side of push, and this decision are public.

## Decision

### Protocol

Additive, so the protocol stays at version 1:

- `Platform` becomes `'ios' | 'android'`.
- `POST /v1/devices/register` also accepts `{ grant, platform: 'android', fcmToken, bundleId, device? }`. There is no `environment`, because FCM has none; the relay stores `production`. `bundleId` is the Android package name, which the relay checks against a new setting, `RELAY_ANDROID_PACKAGES`.
- `POST /v1/devices/token` also accepts `{ deviceId, fcmToken }`. A device can only send the kind of token its platform has.
- `PushData` is unchanged. For FCM it travels as a JSON string in the data field `oc`, since FCM data values are strings.
- The installation's `POST .../push/subscriptions` takes an optional `platform`, defaulting to `ios`, which it shows to the member and otherwise ignores. `push_subscriptions` is rebuilt to allow `android` (migration 0015).

### Relay

- An `FcmTransport`, a seam like `ApnsTransport`, with a fetch implementation for FCM HTTP v1 and a mock for tests.
- The relay signs in with a Google service account, the Worker secret `FCM_SERVICE_ACCOUNT`. It mints an access token from it and keeps it per isolate for 50 minutes. Google does not limit token minting as Apple does, so no Durable Object is needed.
- Every Android notification is a high-priority, **data-only** message. It carries only what an APNs payload carries: opaque IDs, the event, and this phone's ciphertext. The relay still writes no text (ADR-0017).
- `UNREGISTERED` and `SENDER_ID_MISMATCH` delete the device, as APNs's 410 does. Authentication errors never delete devices.
- The `devices` table is rebuilt to allow `android`. The token column keeps its name, `apns_token`, and holds either kind, encrypted as before. Renaming it would be a contract change for nothing.
- The daily self-check also asks FCM to validate a message to a token no phone has.

### On the phone

- The same app, built for Android from the same code. The few iOS-only parts get Android equivalents: SF Symbols are replaced by icons that draw on both platforms, and the keychain module gains a Kotlin side.
- **Keys.** Each subscription's X25519 private key is encrypted with AES-256-GCM under a key in the Android Keystore, which cannot be read out of the phone, and stored in the app's private storage, which is excluded from backups. This matches iOS's "this device only, after first unlock".
- **Decryption.** The app's own `FirebaseMessagingService` receives the data message, finds the key by `subscriptionId`, opens the HPKE ciphertext with the same steps as `notification-crypto.ts`, checks the associated data, and posts the notification: the workspace as title, `sender: text` as body. It replaces Expo's messaging service, and hands token changes on to it.
- **Fallback.** If anything fails, it posts the app's own phrase for the event, in the phone's language, with no workspace name, as iOS does with `loc-key`.
- **Cryptography library.** Android has no X25519 in every supported version, so the X25519 step uses Bouncy Castle (MIT licence, the lightweight API only). HKDF and AES-GCM use the platform's own `javax.crypto`. The Kotlin code is tested against the RFC 9180 test vectors and against ciphertext from `notification-crypto.ts`.
- **Release.** Google Play, starting with internal testing. The package name is `com.orangolabs.openchat`, as the iOS bundle ID is. The Firebase project is used only for FCM: Analytics and other Firebase products are off, and the app includes only the messaging library.

## Consequences

- Google's push service carries the ciphertext to Android phones, as Apple's does to iPhones. Neither can read it. Google also learns when a phone receives a notification, as Apple does.
- The managed relay holds one more secret, the FCM service account key. That account's project holds nothing else.
- Someone who runs their own relay and wants Android needs their own Firebase project and their own build of the app, just as they need their own APNs key and iOS build. The relay works without `FCM_SERVICE_ACCOUNT`, for iPhones only.
- Android notifications show message text by default, as on iOS. Android's lock-screen setting hides it, which the user guide says.
- The app adds Firebase Cloud Messaging and Bouncy Castle to its licence notices.

## Alternatives considered

- **A notification posted by FCM itself, with fixed text.** That would show no message text, which ADR-0017 was written to provide.
- **Google Tink's HPKE.** Its HPKE primitives are internal API, and Tink is much larger than what one X25519 step needs.
- **Storing the private key in the Keystore directly.** The Keystore supports X25519 only from Android 12, and only for some devices. Wrapping it under a Keystore AES key works everywhere the app does.
- **A second relay just for Android.** Two relays to run, and two sets of device records for the same person, with no benefit.
