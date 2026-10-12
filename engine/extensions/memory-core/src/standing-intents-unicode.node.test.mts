import assert from "node:assert/strict";
import { test } from "node:test";
const source = process.env.BRANCH_INTENT_UNICODE_BASELINE ?? new URL("./standing-intents-model.ts", import.meta.url).href;
const { tokenizeIntentText, prepareStandingIntentMatch, encodeStandingIntentChannelScope, encodeStandingIntentSenderScope } = await import(source);
for (const [composed,decomposed] of [["CAFÉ","CAFE\u0301"],["mañana","man\u0303ana"],["Ångström","A\u030angstro\u0308m"]]) {
  test(`canonically equivalent trigger spelling ${composed} has one shared token identity`, () => {
    assert.deepEqual(tokenizeIntentText(decomposed),tokenizeIntentText(composed));
    const a = prepareStandingIntentMatch({prompt:composed});
    const b = prepareStandingIntentMatch({prompt:decomposed});
    assert.deepEqual(a,b);
  });
}
for(const [word,expected] of [["काम",["काम"]],["किताब",["किताब"]],["ภาษาไทยดี",["ภาษาไทยดี"]]]) {
  test(`combining marks remain inside the trigger word ${word}`,()=>assert.deepEqual(tokenizeIntentText(word),expected));
}
test("different Indic vowel signs cannot collapse into identical trigger tokens",()=>{
  assert.notDeepEqual(tokenizeIntentText("काम"),tokenizeIntentText("कम"));
  assert.notDeepEqual(tokenizeIntentText("कि"),tokenizeIntentText("क"));
});
test("orphan combining marks and punctuation cannot create an intent match",()=>{
  assert.deepEqual(tokenizeIntentText("\u0301 \u093f ? !"),[]);
  assert.equal(prepareStandingIntentMatch({prompt:"\u0301 \u093f ? !"}),undefined);
});
test("ASCII, underscore, hyphen, numbers and phrase boundaries retain upstream token rules",()=>{
  assert.deepEqual(tokenizeIntentText('Deploy release_v2--now at 24/7; foo.bar "quote"'),["deploy","release_v2--now","at","24","7","foo","bar","quote"]);
});
test("prepared matching deduplicates canonical tokens and retains exact tagged scope identities",()=>{
  const input={prompt:"CAFE\u0301 café काम",provider:" Telegram ",accountId:"privateAccount",channel:"CaseSensitiveChat",senderId:"CaseSensitiveSender",nowMs:1234};
  const result=prepareStandingIntentMatch(input);
  assert.deepEqual(result.promptTokens,["café","काम"]);
  assert.equal(result.ftsQuery,'"café" OR "काम"');
  assert.deepEqual(result.channelScopes,[encodeStandingIntentChannelScope({scope:"channel",provider:"telegram",accountId:input.accountId}),encodeStandingIntentChannelScope({scope:"conversation",provider:"telegram",accountId:input.accountId,conversationId:input.channel})]);
  assert.equal(result.senderScope,encodeStandingIntentSenderScope({provider:"telegram",accountId:input.accountId,senderId:input.senderId}));
  assert.equal(result.nowMs,1234);
});
test("normalization does not widen account or sender identity across matching inputs",()=>{
  const first=prepareStandingIntentMatch({prompt:"café",provider:"telegram",accountId:"A",senderId:"É"});
  const second=prepareStandingIntentMatch({prompt:"cafe\u0301",provider:"telegram",accountId:"a",senderId:"E\u0301"});
  assert.deepEqual(first.promptTokens,second.promptTokens);
  assert.notDeepEqual(first.channelScopes,second.channelScopes);
  assert.notEqual(first.senderScope,second.senderScope);
});
