/** Relay protocol types. See docs/notification-relay/protocol.md. */
export const RELAY_PROTOCOL_VERSION = 1 as const;
export const SIGNATURE_DOMAIN = 'OCRELAY-V1' as const;
export const MAX_CLOCK_SKEW_SECONDS = 300;
export const NONCE_TTL_SECONDS = 600;
export const GRANT_MAX_TTL_SECONDS = 300;

export const NOTIFICATION_EVENTS = [
  'new_conversation',
  'new_message',
  'conversation_assigned',
  'conversation_transferred',
  'mention',
  'conversation_updated',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export type PushEnvironment = 'sandbox' | 'production';
export type Platform = 'ios' | 'android';

/** Each person may have this many subscriptions, so a notification carries at most this many payloads. */
export const MAX_NOTIFICATION_PAYLOADS = 20;

/** One phone's copy of the notification, sealed with `sealNotification`. The relay cannot read it. */
export interface NotificationPayload {
  subscriptionId: string;
  ciphertext: string;
}

/**
 * Closed by design. The only content is per-phone ciphertext the relay cannot decrypt (ADR-0017). Adding a
 * readable field here would break the promise that the relay receives no readable content.
 */
export interface NotificationRequest {
  workspaceId: string;
  event: NotificationEvent;
  recipientId: string;
  conversationId: string;
  notificationId: string;
  payloads: NotificationPayload[];
  expiresAt?: string;
  metadata?: { websiteId?: string };
}

export interface NotificationAccepted {
  id: string;
  notificationId: string;
  status: 'queued' | 'duplicate';
}

export interface NotificationStatus {
  id: string;
  notificationId: string;
  status: 'queued' | 'delivering' | 'completed' | 'expired' | 'no_devices';
  outcomes: { delivered: number; invalidToken: number; failed: number; muted: number };
  updatedAt: string;
}

/**
 * The custom key inside the push payload: `oc` in an APNs payload, and the JSON string in the `oc` data field of an
 * FCM message (ADR-0021). The app routes from this alone, and decrypts `c` on the phone.
 */
export interface PushData {
  v: 1;
  event: NotificationEvent;
  installationId: string;
  workspaceId: string;
  conversationId: string;
  notificationId: string;
  subscriptionId: string;
  /** This phone's sealed notification. */
  c: string;
}

export interface DeviceGrantClaims {
  iss: string;
  aud: string;
  wid: string;
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface IosDeviceRegisterRequest {
  grant: string;
  platform: 'ios';
  apnsToken: string;
  bundleId: string;
  environment: PushEnvironment;
  device?: { id: string; secret: string };
}

/** FCM has no sandbox, so an Android phone names no environment (ADR-0021). `bundleId` is the app's package name. */
export interface AndroidDeviceRegisterRequest {
  grant: string;
  platform: 'android';
  fcmToken: string;
  bundleId: string;
  device?: { id: string; secret: string };
}

export type DeviceRegisterRequest = IosDeviceRegisterRequest | AndroidDeviceRegisterRequest;

/** `POST /v1/devices/token`. A device sends the kind of token its platform has. */
export type DeviceTokenRequest = { deviceId: string; apnsToken: string } | { deviceId: string; fcmToken: string };

export interface DeviceRegisterResponse {
  deviceId: string;
  deviceSecret?: string;
  subscriptionId: string;
}

/** Transport seam, because Worker HTTP/2 to APNs is observed behaviour and not a guarantee. See ADR-0006. */
export interface ApnsRequest {
  host: 'api.push.apple.com' | 'api.sandbox.push.apple.com';
  token: string;
  headers: Record<string, string>;
  body: string;
}
export interface ApnsResponse {
  status: number;
  apnsId?: string;
  reason?: string;
  timestamp?: number;
}
export interface ApnsTransport {
  send(request: ApnsRequest): Promise<ApnsResponse>;
}

/** FCM HTTP v1 (ADR-0021). A seam like the APNs one, so tests and local development need no Google account. */
export interface FcmRequest {
  projectId: string;
  /** An OAuth 2.0 access token for the relay's service account. */
  accessToken: string;
  /** The `message` object of `projects.messages.send`. */
  message: Record<string, unknown>;
  /** Asks FCM to check the request without sending it. Used by the self-check. */
  validateOnly?: boolean;
}
export interface FcmResponse {
  status: number;
  /** `error.details[].errorCode` when FCM gives one, such as `UNREGISTERED`, else `error.status`. */
  errorCode?: string;
}
export interface FcmTransport {
  send(request: FcmRequest): Promise<FcmResponse>;
}
