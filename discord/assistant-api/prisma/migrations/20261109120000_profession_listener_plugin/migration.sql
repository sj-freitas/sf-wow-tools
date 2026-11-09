-- Guild Chat Profession Listener plugin (src/professions/crafter-listener.service.ts): answers
-- "who can craft …?" in a channel as messages arrive. No new table: it is a guild_plugins row
-- (with a placeholder schedule) and logs each answer in plugin_runs.
ALTER TYPE "plugin_kind" ADD VALUE 'PROFESSION_LISTENER';
