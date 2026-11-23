-- A member's own choice to be away: they then do not make the widget say the team is online.
-- ADD COLUMN only: nothing is rebuilt, and the previous Worker never reads or writes it.
ALTER TABLE `workspace_members` ADD `away` integer DEFAULT false NOT NULL;
