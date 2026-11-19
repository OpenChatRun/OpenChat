-- ADR-0021: a push subscription can be an Android phone's. SQLite cannot change a CHECK, so the table is rebuilt.
-- Nothing references push_subscriptions, so dropping it cascades nowhere. foreign_keys stays on, as D1 requires;
-- defer_foreign_keys holds the check on member_id to the end of the migration. The previous Worker writes only
-- 'ios', which the new CHECK still allows.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`member_id` text NOT NULL,
	`relay_id` text NOT NULL,
	`relay_subscription_id` text NOT NULL,
	`preview_key` text DEFAULT '' NOT NULL,
	`platform` text NOT NULL,
	`device_label` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`,`member_id`) REFERENCES `workspace_members`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_subscriptions_platform_ck" CHECK("platform" IN ('ios', 'android'))
);
--> statement-breakpoint
INSERT INTO `__new_push_subscriptions`("id", "workspace_id", "member_id", "relay_id", "relay_subscription_id", "preview_key", "platform", "device_label", "created_at", "updated_at") SELECT "id", "workspace_id", "member_id", "relay_id", "relay_subscription_id", "preview_key", "platform", "device_label", "created_at", "updated_at" FROM `push_subscriptions`;--> statement-breakpoint
DROP TABLE `push_subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_push_subscriptions` RENAME TO `push_subscriptions`;--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_relay_uq` ON `push_subscriptions` (`relay_id`,`relay_subscription_id`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_member_idx` ON `push_subscriptions` (`workspace_id`,`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_tenant_uq` ON `push_subscriptions` (`workspace_id`,`id`);
