-- ADR-0022, step 3: answers learned from resolved conversations. A new table, and columns added with ADD COLUMN,
-- which changes the schema and no rows. Nothing is rebuilt.
CREATE TABLE `assistant_learned` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`website_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`status` text NOT NULL,
	`discard_reason` text,
	`learned_seq` integer NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`indexed_generation` integer,
	`decided_by_member_id` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`,`conversation_id`) REFERENCES `conversations`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`website_id`) REFERENCES `websites`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assistant_learned_status_ck" CHECK("assistant_learned"."status" IN ('pending','approved','rejected','discarded'))
);
--> statement-breakpoint
CREATE INDEX `assistant_learned_website_idx` ON `assistant_learned` (`workspace_id`,`website_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_learned_conversation_uq` ON `assistant_learned` (`workspace_id`,`conversation_id`);--> statement-breakpoint
ALTER TABLE `assistant_settings` ADD `learn` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `assistant_auto_approve` integer DEFAULT false NOT NULL;