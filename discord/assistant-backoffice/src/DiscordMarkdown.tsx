import { useState, type ReactNode } from 'react';

/** Names for the ids that appear in a post, so mentions can be shown like Discord shows them. */
export interface MentionNames {
  users: Map<string, string>;
  roles: Map<string, string>;
  channels: Map<string, string>;
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[\s\S]+?\*\*)|(__[\s\S]+?__)|(~~[\s\S]+?~~)|(\|\|[\s\S]+?\|\|)|(\*[^*\n]+?\*)|(_[^_\n]+?_)|(<@!?\d+>|<@&\d+>|<#\d+>)|(<a?:\w+:\d+>)|(https?:\/\/[^\s<]+)|(@everyone|@here)/g;

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      className={shown ? 'md-spoiler md-spoiler-shown' : 'md-spoiler'}
      onClick={() => setShown(true)}
      title={shown ? undefined : 'Click to reveal'}
    >
      {children}
    </span>
  );
}

function inline(text: string, names: MentionNames): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    if (index > last) nodes.push(text.slice(last, index));
    last = index + match[0].length;
    const token = match[0];
    const k = key++;
    if (match[1]) nodes.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (match[2]) nodes.push(<strong key={k}>{inline(token.slice(2, -2), names)}</strong>);
    else if (match[3]) nodes.push(<u key={k}>{inline(token.slice(2, -2), names)}</u>);
    else if (match[4]) nodes.push(<s key={k}>{inline(token.slice(2, -2), names)}</s>);
    else if (match[5]) nodes.push(<Spoiler key={k}>{inline(token.slice(2, -2), names)}</Spoiler>);
    else if (match[6] || match[7]) nodes.push(<em key={k}>{inline(token.slice(1, -1), names)}</em>);
    else if (match[8]) {
      const id = token.replace(/\D/g, '');
      if (token.startsWith('<#')) {
        nodes.push(
          <span key={k} className="md-mention">
            #{names.channels.get(id) ?? 'channel'}
          </span>,
        );
      } else if (token.startsWith('<@&')) {
        nodes.push(
          <span key={k} className="md-mention">
            @{names.roles.get(id) ?? 'role'}
          </span>,
        );
      } else {
        nodes.push(
          <span key={k} className="md-mention">
            @{names.users.get(id) ?? 'user'}
          </span>,
        );
      }
    } else if (match[9]) {
      const id = /:(\d+)>/.exec(token)?.[1];
      nodes.push(
        <img
          key={k}
          className="md-emoji"
          alt={token}
          src={`https://cdn.discordapp.com/emojis/${id}.png?size=32`}
        />,
      );
    } else if (match[10]) {
      nodes.push(
        <a key={k} href={token} target="_blank" rel="noreferrer">
          {token}
        </a>,
      );
    } else
      nodes.push(
        <span key={k} className="md-mention">
          {token}
        </span>,
      );
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * A small preview of Discord's message markdown: bold, italic, underline, strikethrough,
 * spoilers, inline and block code, quotes, headings, lists, links, and mentions (shown with
 * their names where known). It only builds React elements, never raw HTML.
 */
export function DiscordMarkdown({ text, names }: { text: string; names: MentionNames }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key++} className="md-code">
          {body.join('\n')}
        </pre>,
      );
    } else if (line.startsWith('> ')) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) body.push(lines[i++].slice(2));
      blocks.push(
        <blockquote key={key++} className="md-quote">
          {inline(body.join('\n'), names)}
        </blockquote>,
      );
    } else if (/^#{1,3} /.test(line)) {
      const level = line.indexOf(' ');
      blocks.push(
        <div key={key++} className={`md-heading md-h${level}`}>
          {inline(line.slice(level + 1), names)}
        </div>,
      );
      i++;
    } else if (/^[-*] /.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].slice(2), names)}</li>);
        i++;
      }
      blocks.push(<ul key={key++}>{items}</ul>);
    } else {
      blocks.push(
        <div key={key++} className="md-line">
          {line === '' ? ' ' : inline(line, names)}
        </div>,
      );
      i++;
    }
  }
  return <div className="md-preview">{blocks}</div>;
}
