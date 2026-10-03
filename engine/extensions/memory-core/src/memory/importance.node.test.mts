import assert from "node:assert/strict";
import {test} from "node:test";
const source = process.env.BRANCH_IMPORTANCE_BASELINE ?? new URL("./importance.ts", import.meta.url).href;
const { applyImportanceMultiplier } = await import(source);
for (const importance of [NaN, Infinity, -Infinity]) {
  test(`nonfinite importance ${importance} preserves finite recall and metadata`, () => {
    const entry = Object.freeze({score:0.72,importance,path:"memory/topic.md",provenance:{source:"scratch"}});
    const entries = Object.freeze([entry]);
    const output = applyImportanceMultiplier(entries);
    assert.equal(output.length,1);
    assert.equal(output[0].score,entry.score);
    assert.equal(output[0].path,entry.path);
    assert.equal(output[0].provenance,entry.provenance);
    assert.ok(Object.is(output[0].importance,importance));
    assert.notEqual(output[0],entry);
    assert.notEqual(output,entries);
  });
}
for (const [importance,multiplier] of [[-10,0.8],[0,0.8],[1,0.8],[4.9,0.95],[5,1],[10,1.25],[25,1.25],[Number.MAX_VALUE,1.25]]) {
  test(`valid importance ${importance} retains pinned-source multiplier ${multiplier}`, () => {
    assert.equal(applyImportanceMultiplier([{score:0.8,importance}])[0].score,0.8*multiplier);
  });
}
test("null and missing importance retain neutral source defaults", () => {
  assert.deepEqual(applyImportanceMultiplier([{score:0.8},{score:0.4,importance:null}]),[{score:0.8},{score:0.4,importance:null}]);
});
test("mixed valid and invalid metadata cannot contaminate neighboring recall", () => {
  const entries = [{score:0.7,importance:NaN},{score:0.7,importance:10},{score:0,importance:Infinity},{score:-0.2,importance:-Infinity}];
  assert.deepEqual(applyImportanceMultiplier(entries).map((entry:{score:number})=>entry.score),[0.7,0.875,0,-0.2]);
  assert.equal(entries[1].score,0.7);
});
test("empty recall remains empty",()=>assert.deepEqual(applyImportanceMultiplier([]),[]));
