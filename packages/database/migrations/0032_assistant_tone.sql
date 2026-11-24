-- The assistant's tone and its handover message, as the team writes them. Two nullable columns: the previous Worker
-- names the columns it reads and writes, so it neither sees nor needs them.
ALTER TABLE `assistant_settings` ADD `instructions` text;--> statement-breakpoint
ALTER TABLE `assistant_settings` ADD `handover_message` text;