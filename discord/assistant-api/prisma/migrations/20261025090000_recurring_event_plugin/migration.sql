-- Recurring Event plugins (src/signup/recurring-event.plugin.ts): on a schedule, archive the events
-- of a channel and post the next one. Only a new value of the plugin kind; no table changes.
ALTER TYPE "plugin_kind" ADD VALUE 'RECURRING_EVENT';
