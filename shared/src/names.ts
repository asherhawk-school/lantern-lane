const BLOCKED = [
  'fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'whore', 'slut', 'dick', 'cock', 'pussy', 'penis', 'vagina', 'admin', 'moderator',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

/** Display names: 2-12 characters, letters, digits, spaces, dashes and underscores. */
export function checkName(raw: unknown): NameCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'Pick a name' };
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, reason: 'Names need at least 2 characters' };
  if (name.length > 12) return { ok: false, reason: 'Names can be at most 12 characters' };
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) return { ok: false, reason: 'Use letters, numbers, spaces, - or _' };

  const flat = name
    .toLowerCase()
    .replace(/[0134578]/g, (c) => LEET[c])
    .replace(/[^a-z]/g, '');
  if (BLOCKED.some((w) => flat.includes(w))) return { ok: false, reason: 'Please pick a different name' };
  return { ok: true, name };
}
