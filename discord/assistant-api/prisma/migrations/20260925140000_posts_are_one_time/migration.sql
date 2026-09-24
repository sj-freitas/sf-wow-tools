-- Scheduled posts are one-time: one row tracks one Discord message. Turn any daily/weekly post
-- into a one-time one (its next run, or last run, becomes its date) so it can't post twice.
UPDATE "scheduled_tasks"
SET "schedule_kind" = 'ONCE',
    "run_at" = COALESCE("next_run_at", "last_run_at", now()),
    "time_of_day" = NULL,
    "weekday" = NULL
WHERE "schedule_kind" <> 'ONCE';
