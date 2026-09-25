import type { APIEmbed } from 'discord-api-types/v10';

const BLURPLE = 0x5865f2;
const GREEN = 0x57f287;

/** Embed fields hold at most 1024 characters. */
export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const withImage = (name?: string): Pick<APIEmbed, 'image'> =>
  name ? { image: { url: `attachment://${name}` } } : {};

/** What the officers see in the request channel when a member writes to them. */
export function requestEmbed(input: {
  publicId: number;
  content: string;
  isAnonymous: boolean;
  userId: string;
  followUp: boolean;
  /** Name of the file sent along with the embed, shown as its picture. */
  imageName?: string;
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
    ...withImage(input.imageName),
  };
}

/** An officer's reply, as posted in the request channel for the other officers. */
export function officerReplyEmbed(input: {
  publicId: number;
  officerName: string;
  content: string;
  imageName?: string;
}): APIEmbed {
  return {
    title: `Reply · #${input.publicId}`,
    description: input.content,
    color: GREEN,
    fields: [{ name: 'Officer', value: input.officerName }],
    ...withImage(input.imageName),
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
  /** `</contact-officer:id>`, when known: clicking it opens the command. */
  commandMention?: string | null;
  /** When the DM has a Reply button, the text points to it first. */
  withButton?: boolean;
  imageName?: string;
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
        value: replyInstructions(
          input.guildName,
          input.publicId,
          input.commandMention,
          input.withButton,
        ),
      },
    ],
    footer: { text: `Conversation #${input.publicId}` },
    ...withImage(input.imageName),
  };
}

/** How a member writes back: a clickable command when we know it, plus a line to copy. */
export function replyInstructions(
  guildName: string,
  publicId: number,
  commandMention?: string | null,
  withButton = false,
): string {
  return [
    ...(withButton ? ['Press **Reply** below to write back.', 'Or, the slash command way:'] : []),
    commandMention
      ? `On the ${guildName} server, click ${commandMention}, set **conversation-id** to \`${publicId}\` and write your message.`
      : `On the ${guildName} server, use /contact-officer with **conversation-id** \`${publicId}\`.`,
    `Or copy this into a message box and add your text after "message:":`,
    `\`\`\`/contact-officer conversation-id:${publicId} message:\`\`\``,
  ].join('\n');
}

const REPLY_BUTTON = 'contact-reply';

/** The id of a Reply button: it carries the guild and the conversation the member answers. */
export const replyButtonId = (guildId: string, publicId: number): string =>
  `${REPLY_BUTTON}:${guildId}:${publicId}`;

export function parseReplyButtonId(
  customId: string | undefined,
): { guildId: string; publicId: number } | null {
  const [prefix, guildId, publicId] = (customId ?? '').split(':');
  if (prefix !== REPLY_BUTTON || !guildId || !/^\d{8}$/.test(publicId ?? '')) return null;
  return { guildId, publicId: Number(publicId) };
}

/** The row with the Reply button under the officer's answer in the member's DM. */
export const replyButtonRow = (guildId: string, publicId: number): unknown[] => [
  {
    type: 1,
    components: [
      { type: 2, style: 1, label: 'Reply', custom_id: replyButtonId(guildId, publicId) },
    ],
  },
];
