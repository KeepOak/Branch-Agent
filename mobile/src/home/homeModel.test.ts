import { readApproval } from '../approvals/approvals';
import { chatRows, readAgents } from '../chats/chatList';
import { fixtureApprovals } from '../testing/approvalFixtures';
import { FIXTURE_NOW, fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import {
  finishedNow,
  gatewayWord,
  greet,
  homeNeeds,
  homeSummary,
  isAdvanced,
  laterUpdate,
  workingNow,
  workingStep,
} from './homeModel';

const { agents, mainKey } = readAgents(fixtureAgents);
const rows = chatRows({ sessions: fixtureSessions }, agents, mainKey);
const trunks = Object.fromEntries(agents);
const exec = readApproval(fixtureApprovals.exec[0], 'exec')!;
const plugin = readApproval(fixtureApprovals.plugin[0], 'plugin')!;

describe('home model', () => {
  it('greets from the hour the way the preview does', () => {
    const at = (hour: number) => new Date(2026, 9, 16, hour, 0).getTime();
    expect(greet(at(4))).toBe('Good evening');
    expect(greet(at(5))).toBe('Good morning');
    expect(greet(at(11))).toBe('Good morning');
    expect(greet(at(12))).toBe('Good afternoon');
    expect(greet(at(17))).toBe('Good afternoon');
    expect(greet(at(18))).toBe('Good evening');
    expect(greet(FIXTURE_NOW)).toBe('Good evening');
  });

  it('writes the one-line summary from how many wait and how many work', () => {
    expect(homeSummary(0, 0)).toBe('Nothing waiting for you · 0 working');
    expect(homeSummary(2, 1)).toBe('2 waiting for you · 1 working');
  });

  it('names an unfinished Home feature the way the owner rule asks', () => {
    expect(laterUpdate('Talk')).toBe('Talk comes in a later update.');
    expect(isAdvanced('regular')).toBe(false);
    expect(isAdvanced('advanced')).toBe(true);
    expect(isAdvanced('technical')).toBe(true);
  });

  it('lists working Trunk chats and skips rooms', () => {
    const working = workingNow(rows);
    expect(working.map((r) => r.key)).toEqual(['agent:oak:main']);
    expect(workingStep(working[0])).toEqual({ text: 'Running the window tests now', steps: ['now'] });
  });

  it('picks recent idle chats for Finished, not invented trips', () => {
    const finished = finishedNow(rows, FIXTURE_NOW);
    expect(finished.map((r) => r.key)).toEqual(['agent:main:main', 'agent:researcher:main']);
    expect(finished.every((r) => r.preview && !r.working && !r.needsYou)).toBe(true);
    expect(finished.some((r) => /Lisbon is booked/.test(r.preview))).toBe(false);
  });

  it('builds Needs you cards with Allow or Send, Deny, and two field rows', () => {
    const needs = homeNeeds([exec, plugin], trunks);
    expect(needs).toHaveLength(2);
    expect(needs[0]).toMatchObject({ id: 'exec-1', title: 'Run a command', yes: 'Allow', no: 'Deny', trunk: { name: 'Oak' } });
    expect(needs[1]).toMatchObject({
      id: 'plugin:mail-1',
      title: 'Send an email to Dana?',
      yes: 'Send it',
      no: 'Don’t send',
      fields: [
        ['To', 'Dana Whitfield'],
        ['Subject', 'September expenses'],
      ],
    });
  });

  it('says the gateway is on or off from the live connection, never a machine name', () => {
    expect(gatewayWord(true)).toBe('on');
    expect(gatewayWord(false)).toBe('off');
  });
});
