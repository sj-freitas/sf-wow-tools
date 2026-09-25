const COOKIE = 'guildAssistant.lastGuild';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** The guild the user last opened, so the next visit can go straight to it. */
export function readLastGuildId(): string | undefined {
  const match = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return match ? decodeURIComponent(match) : undefined;
}

/** Remembers a guild (its id, so renaming it doesn't matter) in a cookie for a year. */
export function rememberLastGuild(guildId: string): void {
  document.cookie = `${COOKIE}=${encodeURIComponent(guildId)}; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax`;
}

export function forgetLastGuild(): void {
  document.cookie = `${COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}
