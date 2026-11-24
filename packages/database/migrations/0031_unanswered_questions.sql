-- Questions the assistant could not answer, for supervisors. They are read from its handover messages, so the only
-- new rows are a supervisor's decisions about them. A new table and a new index only: the previous Worker never
-- reads either, and the index covers the assistant's messages alone, so making it reads few rows.
CREATE TABLE `assistant_question_reviews` (
	`workspace_id` text NOT NULL,
	`message_id` text NOT NULL,
	`outcome` text NOT NULL,
	`member_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `message_id`),
	FOREIGN KEY (`workspace_id`,`message_id`) REFERENCES `messages`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assistant_question_reviews_outcome_ck" CHECK("assistant_question_reviews"."outcome" IN ('answered','dismissed'))
);
--> statement-breakpoint
CREATE INDEX `messages_assistant_idx` ON `messages` (`workspace_id`,`created_at`) WHERE "messages"."assistant_id" IS NOT NULL;