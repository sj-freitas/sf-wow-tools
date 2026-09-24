import type { APIEmbed } from 'discord-api-types/v10';

const BLURPLE = 0x5865f2;
const GREEN = 0x57f287;

/** Embed fields hold at most 1024 characters. */
export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** What the officers see in the request channel when a member writes to them. */
export function requestEmbed(input: {
  publicId: number;
  content: string;
  isAnonymous: boolean;
  userId: string;
  followUp: boolean;
}): APIEmbed {
  return {
    title: `${input.followUp ? 'Follow-up' : 'Officer request'} · #${input.publicId}`,
    description: input.content,
    color: BLURPLE,
    // A mention inside an embed is a clickable profile link and never pings.
    fields: [
      { name: 'From', value: input.isAnonymous ? 'Anonymous member' : `<@${input.userId}>` },
    ],
    footer: { text: `Reply with /contact-officer-reply conversation-id:${input.publicId}` },
  };
}

/** An officer's reply, as posted in the request channel for the other officers. */
export function officerReplyEmbed(input: {
  publicId: number;
  officerName: string;
  content: string;
}): APIEmbed {
  return {
    title: `Reply · #${input.publicId}`,
    description: input.content,
    color: GREEN,
    fields: [{ name: 'Officer', value: input.officerName }],
  };
}

/** What the member receives by DM: the officer's reply, their original request, and how to answer. */
export function memberDmEmbed(input: {
  guildName: string;
  guildRealm: string;
  publicId: number;
  officerName: string;
  originalRequest: string;
  reply: string;
}): APIEmbed {
  return {
    title: `An officer of ${input.guildName} replied to your request`,
    description: input.reply,
    color: GREEN,
    fields: [
      { name: 'Guild', value: `${input.guildName} · ${input.guildRealm}` },
      { name: 'Replied by', value: input.officerName },
      { name: 'Your request', value: truncate(input.originalRequest, 1000) },
      {
        name: 'To reply',
        value: `On the ${input.guildName} server, use /contact-officer and set conversation-id to ${input.publicId}.`,
      },
    ],
    footer: { text: `Conversation #${input.publicId}` },
  };
}
