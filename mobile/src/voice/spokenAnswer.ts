import type { ApprovalDecision } from '../approvals/approvals';

/** The whole answers that count as "yes" and "no" in a call, after spokenWords. Closed lists, matched whole: a
 *  leading "yes" with more after it ("yes but don't send it") is not consent, and nothing else is either. Copied
 *  from the window call screen (window/src/composer/VoiceParts.tsx). */
const SAID_YES = new Set([
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
  'ok',
  'okay',
  'go ahead',
  'do it',
  'yes please',
  'yes go ahead',
  'yes do it',
  'yeah go ahead',
  'ok go ahead',
  'okay go ahead',
  'sure go ahead',
  'go for it',
  'allow it',
  'send it',
]);
const SAID_NO = new Set([
  'no',
  'nope',
  'nah',
  'no thanks',
  'no thank you',
  "don't",
  'dont',
  'do not',
  "don't do it",
  'dont do it',
  'do not do it',
  "don't send it",
  'dont send it',
  'do not send it',
  'stop',
  'deny',
  'deny it',
  'cancel',
  "no don't",
  'no dont',
  'no stop',
]);

/** A caption as the lists hold it: lower case, straight apostrophes, no punctuation, single spaces. */
export function spokenWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[.,!?;:"“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words a person says to answer an approval in a call: a whole "yes" allows it once, a whole "no" refuses it. */
export function spokenAnswer(text: string): ApprovalDecision | null {
  const t = spokenWords(text);
  if (SAID_YES.has(t)) return 'allow-once';
  if (SAID_NO.has(t)) return 'deny';
  return null;
}
