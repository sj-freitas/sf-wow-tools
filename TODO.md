- Addon
    - Sort Groups
    - Auto Invite
- Bot
    - Prompts user to reigster their characters
        - Class;Specs;Main Spec;
    - Character registration via WoW Armory API
        - Fetch class/role (and level) from the armory using name + realm, instead of asking the user
        - /character-add currently takes class + role by hand and leaves level at 1
    - Discord Commands
        - /list
        - 
    - Backoffice
        - Discord Auth
        - 


- Infrastructure
    - Replace the in-memory caches with a shared one (looking into Redis)
        - Guild ranks cache (discord/assistant-api/src/guilds/ranks.service.ts, `ranksCacheMs`)
        - In-flight Discord syncs per user (`inFlightSyncs` in auth.service.ts)
        - Live updates event bus (realtime.service.ts): also per-process, Redis pub/sub would allow several API instances
        - Until then everything assumes a single API instance

Notes:
    Domain: guildassistant.app
