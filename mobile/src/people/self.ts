// Who is using this phone: users.self, the same fallbacks as the window's PersonMenu and
// Settings › People (display name, then GitHub login, then an email, then "Owner").
// Preview: youSecPE18 / peopleTab head in design/spec-v23/index.html §4.7.2.

import { laterUpdate, showsLaterUpdates, type ShowLevel } from '../settings/showLevel';

/** The engine's owner profile id (gateway-protocol user-profile-constants.ts). */
export const OWNER_ID = 'gateway-owner';

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

export type SelfProfile = {
  id: string | null;
  name: string;
  emails: string[];
  role: string;
  owner: boolean;
  hasAvatar: boolean;
};

export const EMPTY_SELF: SelfProfile = {
  id: null,
  name: 'Owner',
  emails: [],
  role: '',
  owner: false,
  hasAvatar: false,
};

/** users.self → the person this connection is. A missing profile is "Owner", as the window's PersonMenu. */
export function readSelf(result: unknown): SelfProfile {
  const profile = rec(rec(result).profile);
  const id = str(profile.id) || null;
  const emails = strs(profile.emails);
  const github = str(rec(profile.githubIdentity).login);
  const owner = id === OWNER_ID;
  const name = str(profile.displayName) || github || emails[0] || (owner || !id ? 'Owner' : id);
  const assigned = str(profile.role);
  return {
    id,
    name,
    emails,
    role: owner ? 'Owner' : assigned,
    owner,
    hasAvatar: profile.hasAvatar === true,
  };
}

/** Window PersonMenu.readPersonName: display name, else first email, else "Owner". */
export function readPersonName(result: unknown): string {
  return readSelf(result).name;
}

/** Preview phead / meG18: one or two letters from the name. */
export function initials(name: string, max = 2): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, max)
    .toUpperCase();
  return letters || '?';
}

/** Window people-data.accessLine, from operator scopes this connection was granted. */
export function accessLine(scopes: readonly string[]): string {
  if (scopes.includes('operator.admin')) return 'You may change how Branch is set up.';
  if (scopes.includes('operator.write')) return 'You may send messages and make changes.';
  if (scopes.includes('operator.read')) return 'You may look but not change things.';
  return 'This connection may do only some things.';
}

export type YouAction = 'computer';

export type YouRowSpec = {
  id: string;
  label: string;
  detail: string;
  value?: string;
  action?: YouAction;
};

/**
 * Preview youSecPE18 rows for the phone. Ready rows show real values. Your picture is always
 * shown with why it is off. Other unfinished rows wait for Advanced. Nothing here invents
 * an email, plan, or team.
 */
export function youRows({
  level,
  self,
  access,
  computer,
  computerStatus,
  scopes,
}: {
  level: ShowLevel;
  self: SelfProfile;
  access: string;
  computer: string;
  computerStatus: string;
  scopes: readonly string[];
}): { id: string; title: string; rows: YouRowSpec[] }[] {
  const later = showsLaterUpdates(level);
  const you: YouRowSpec[] = [
    { id: 'name', label: 'Your name', detail: 'What teammates see', value: self.name },
    { id: 'picture', label: 'Your picture', detail: laterUpdate('Your picture') },
  ];
  if (!self.owner && self.emails.length) {
    you.push({
      id: 'emails',
      label: 'Emails',
      detail: 'The emails linked to you. Ask the owner to change them.',
      value: self.emails.join(', '),
    });
  }
  if (later) {
    you.push(
      { id: 'instructions', label: 'Your own instructions', detail: laterUpdate('Your own instructions'), value: 'Just about you' },
      { id: 'accounts', label: 'Your own accounts', detail: laterUpdate('Your own accounts'), value: 'Accounts only you use' },
    );
  }
  const accessRows: YouRowSpec[] = [{ id: 'access', label: 'Your access', detail: access }];
  if (level === 'technical' && scopes.length) {
    accessRows.push({
      id: 'scopes',
      label: 'Granted when you connected',
      detail: 'A role can narrow these, never widen them.',
      value: scopes.join(' · '),
    });
  }
  return [
    { id: 'you', title: 'You', rows: you },
    { id: 'access', title: 'Your access', rows: accessRows },
    {
      id: 'branch',
      title: 'This Branch',
      rows: [{ id: 'computer', label: 'This Branch', detail: computerStatus, value: computer, action: 'computer' }],
    },
  ];
}
