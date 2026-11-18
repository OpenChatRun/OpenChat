CREATE INDEX `attachments_conversation_idx` ON `attachments` (`workspace_id`,`conversation_id`);--> statement-breakpoint
CREATE INDEX `auth_tokens_user_idx` ON `auth_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `automation_runs_conversation_idx` ON `automation_runs` (`workspace_id`,`conversation_id`);--> statement-breakpoint
CREATE INDEX `contact_tags_tag_idx` ON `contact_tags` (`workspace_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `contacts_merged_idx` ON `contacts` (`workspace_id`,`merged_into_contact_id`) WHERE "contacts"."merged_into_contact_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `conversation_tags_tag_idx` ON `conversation_tags` (`workspace_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `conversations_website_idx` ON `conversations` (`workspace_id`,`website_id`);--> statement-breakpoint
CREATE INDEX `invitations_inviter_idx` ON `invitations` (`workspace_id`,`invited_by_member_id`);--> statement-breakpoint
CREATE INDEX `visitors_website_idx` ON `visitors` (`workspace_id`,`website_id`);