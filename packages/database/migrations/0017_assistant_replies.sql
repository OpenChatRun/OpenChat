-- ADR-0022, step 2: the assistant answers visitors. Columns only: ADD COLUMN changes the schema and no rows, so
-- it takes the same time on any size of database. The CHECKs are written here by hand, because declaring them in
-- the Drizzle schema would make it rebuild messages and conversations.
ALTER TABLE `assistant_settings` ADD `enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `assistant_state` text CONSTRAINT `conversations_assistant_state_ck` CHECK (`assistant_state` IN ('answering', 'handed_over', 'stopped'));--> statement-breakpoint
ALTER TABLE `messages` ADD `assistant_id` text CONSTRAINT `messages_assistant_ck` CHECK (`assistant_id` IS NULL OR `sender_type` = 'system');
