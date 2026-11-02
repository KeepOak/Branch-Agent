import { accessLine, EMPTY_SELF, FAILED_SELF, initials, readPersonName, readSelf, youRows } from './self';
import { laterUpdate } from '../settings/showLevel';

describe('readSelf', () => {
  it('uses display name, then GitHub login, then an email, then Owner', () => {
    expect(readSelf({ profile: { id: 'p1', displayName: 'Ada' } }).name).toBe('Ada');
    expect(readSelf({ profile: { id: 'p1', displayName: '  ', githubIdentity: { login: 'ada' } } }).name).toBe('ada');
    expect(readSelf({ profile: { id: 'p1', emails: ['ada@example.test'] } }).name).toBe('ada@example.test');
    expect(readSelf(null)).toEqual(EMPTY_SELF);
    expect(readSelf({ profile: { id: 'gateway-owner' } }).name).toBe('Owner');
    expect(readSelf({ profile: { id: 'gateway-owner' } }).owner).toBe(true);
    expect(readSelf({ profile: { id: 'gateway-owner' } }).role).toBe('Owner');
    expect(FAILED_SELF.name).toBe('');
    expect(FAILED_SELF.name).not.toBe('Owner');
  });

  it('matches PersonMenu: name, email, Owner', () => {
    expect(readPersonName({ profile: { displayName: 'Ada', emails: [] } })).toBe('Ada');
    expect(readPersonName({ profile: { displayName: '', emails: ['ada@example.test'] } })).toBe('ada@example.test');
    expect(readPersonName(null)).toBe('Owner');
  });
});

describe('initials and access', () => {
  it('takes up to two letters from the name', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('Owner', 1)).toBe('O');
    expect(initials('  ')).toBe('?');
  });

  it('names what this connection may do from real scopes', () => {
    expect(accessLine(['operator.admin'])).toBe('You may change how Branch is set up.');
    expect(accessLine(['operator.write', 'operator.read'])).toBe('You may send messages and make changes.');
    expect(accessLine(['operator.read'])).toBe('You may look but not change things.');
    expect(accessLine([])).toBe('This connection may do only some things.');
  });
});

describe('you rows', () => {
  const self = { id: 'gateway-owner', name: 'Owner', emails: [], role: 'Owner', owner: true, hasAvatar: false };

  it('keeps name, picture, access and this Branch at Regular, and hides unfinished rows', () => {
    const groups = youRows({
      level: 'regular',
      self,
      access: 'You may send messages and make changes.',
      computer: 'computer.local:19031',
      computerStatus: 'Connected to your computer',
      scopes: ['operator.read', 'operator.write'],
    });
    expect(groups.flatMap((group) => group.rows.map((row) => row.id))).toEqual(['name', 'picture', 'access', 'computer']);
    expect(groups.flatMap((group) => group.rows).find((row) => row.id === 'picture')?.detail).toBe(laterUpdate('Your picture'));
    expect(groups.find((group) => group.rows.some((row) => row.id === 'instructions'))).toBeUndefined();
  });

  it('shows a real email when the engine sent one, never an invented one', () => {
    const withMail = youRows({
      level: 'regular',
      self: { ...self, id: 'p1', owner: false, emails: ['ada@example.test'] },
      access: 'You may send messages and make changes.',
      computer: 'computer.local:19031',
      computerStatus: 'Connected to your computer',
      scopes: [],
    });
    expect(withMail.flatMap((group) => group.rows).find((row) => row.id === 'emails')?.value).toBe('ada@example.test');
  });

  it('adds unfinished You rows at Advanced, with a later-update line', () => {
    const rows = youRows({
      level: 'advanced',
      self,
      access: 'You may send messages and make changes.',
      computer: 'computer.local:19031',
      computerStatus: 'Connected to your computer',
      scopes: ['operator.write'],
    }).flatMap((group) => group.rows);
    expect(rows.map((row) => row.id)).toEqual(['name', 'picture', 'instructions', 'accounts', 'access', 'computer']);
    expect(rows.find((row) => row.id === 'picture')?.detail).toBe(laterUpdate('Your picture'));
    expect(rows.find((row) => row.id === 'computer')?.action).toBe('computer');
  });

  it('lists granted scopes only at Technical', () => {
    const rows = youRows({
      level: 'technical',
      self,
      access: 'You may send messages and make changes.',
      computer: 'computer.local:19031',
      computerStatus: 'Connected to your computer',
      scopes: ['operator.read', 'operator.write'],
    }).flatMap((group) => group.rows);
    expect(rows.find((row) => row.id === 'scopes')?.value).toBe('operator.read · operator.write');
  });
});
