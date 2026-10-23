-- Which Google calendars feed busy_blocks.
--
-- Sync used to import every calendar ticked in Google's own sidebar, which
-- includes other people's shared calendars: a partner's or coworker's events
-- became the user's commitments and raised false overlap warnings. The user
-- now picks the calendars in Settings.
--
-- Null means "never chosen", which sync reads as the primary calendar only —
-- the one calendar that is certainly the user's own. An empty array is a
-- real choice: import nothing.
alter table oauth_connections
  add column calendar_ids text[];
