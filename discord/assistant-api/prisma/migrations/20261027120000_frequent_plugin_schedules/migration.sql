-- Plugins that run often: every hour (on the hour) and every five minutes. The Professions List
-- offers them; its runs only post when the list changed.
ALTER TYPE "ScheduleKind" ADD VALUE 'HOURLY';
ALTER TYPE "ScheduleKind" ADD VALUE 'EVERY_5_MINUTES';
