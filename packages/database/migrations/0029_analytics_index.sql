-- For the Analytics page, which reads the conversations a workspace started in a period. An index only: nothing is
-- rebuilt, and the previous Worker neither needs it nor minds it.
CREATE INDEX `conversations_created_idx` ON `conversations` (`workspace_id`,`created_at`);