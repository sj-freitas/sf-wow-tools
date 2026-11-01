/** A file a post may carry besides images: its cleaned-up name and its type. */
export interface PostFileType {
  fileName: string;
  contentType: string;
}

export const POST_FILE_KINDS = 'PDF, TXT, CSV, ZIP or audio (MP3, OGG, WAV, FLAC, M4A)';

const MAX_BASE_NAME_LENGTH = 80;

const startsWith = (data: Buffer, text: string, offset = 0): boolean =>
  data.subarray(offset, offset + text.length).toString('latin1') === text;

/** Text has no magic number; a zero byte is what gives away a binary file renamed to `.txt`. */
const isText = (data: Buffer): boolean => !data.includes(0);

/**
 * What may be attached, by extension, each with the check its bytes must pass: everything else
 * (programs, scripts, web pages) is refused, because the bot is who members see posting it.
 */
const ALLOWED: Record<string, { contentType: string; matches: (data: Buffer) => boolean }> = {
  pdf: { contentType: 'application/pdf', matches: (d) => startsWith(d, '%PDF-') },
  txt: { contentType: 'text/plain', matches: isText },
  csv: { contentType: 'text/csv', matches: isText },
  zip: {
    contentType: 'application/zip',
    matches: (d) => startsWith(d, 'PK\x03\x04') || startsWith(d, 'PK\x05\x06'),
  },
  mp3: {
    contentType: 'audio/mpeg',
    matches: (d) => startsWith(d, 'ID3') || (d[0] === 0xff && ((d[1] ?? 0) & 0xe0) === 0xe0),
  },
  ogg: { contentType: 'audio/ogg', matches: (d) => startsWith(d, 'OggS') },
  wav: {
    contentType: 'audio/wav',
    matches: (d) => startsWith(d, 'RIFF') && startsWith(d, 'WAVE', 8),
  },
  flac: { contentType: 'audio/flac', matches: (d) => startsWith(d, 'fLaC') },
  m4a: { contentType: 'audio/mp4', matches: (d) => startsWith(d, 'ftyp', 4) },
};

/** The type of an uploaded file: its extension must be allowed and its bytes must match it. */
export function identifyPostFile(originalName: string, data: Buffer): PostFileType | null {
  const name = originalName.split(/[/\\]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  const allowed = Object.hasOwn(ALLOWED, extension) ? ALLOWED[extension] : undefined;
  if (!allowed?.matches(data)) return null;
  const base = name
    .slice(0, dot)
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/^[. ]+/, '')
    .trim()
    .slice(0, MAX_BASE_NAME_LENGTH);
  return { fileName: `${base || 'file'}.${extension}`, contentType: allowed.contentType };
}
