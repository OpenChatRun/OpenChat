-- ADR-0024, step 2: translations of visitors' messages for members, the workspace's setting, and the characters
-- translated per day. A new table and ADD COLUMN only: nothing is rebuilt, and the previous Worker never reads them.
CREATE TABLE `message_translations` (
	`workspace_id` text NOT NULL,
	`message_id` text NOT NULL,
	`language` text NOT NULL,
	`content` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `message_id`, `language`),
	FOREIGN KEY (`workspace_id`,`message_id`) REFERENCES `messages`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `assistant_usage` ADD `translated_chars` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `translation_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `translation_model` text;