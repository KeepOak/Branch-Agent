import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSkillsCatalogPage, parseCatalogRequest, SLASH_CATALOG_PAGE_SIZE } from "./commands-catalog.ts";
import { buildBuiltinChatCommands } from "./commands-registry.shared.ts";

for (const command of ["commands", "skills"] as const) {
  test(`${command}: exact command token`, () => {
    assert.equal(parseCatalogRequest(`/${command}-other 2`, command), null);
    assert.equal(parseCatalogRequest("/skill sample", command), null);
  });
  test(`${command}: bare and list forms`, () => {
    assert.deepEqual(parseCatalogRequest(`/${command}`, command), { page: 1, paginated: command === "skills" });
    assert.deepEqual(parseCatalogRequest(`/${command} list`, command), { page: 1, paginated: true });
  });
  test(`${command}: explicit page forms`, () => {
    assert.deepEqual(parseCatalogRequest(`/${command} 2`, command), { page: 2, paginated: true });
    assert.deepEqual(parseCatalogRequest(`/${command} list 3`, command), { page: 3, paginated: true });
  });
  test(`${command}: invalid requests give usage`, () => {
    for (const args of ["0", "-1", "1.5", "Infinity", "9007199254740992", "2 extra", "reload", "list list"]) {
      assert.match(parseCatalogRequest(`/${command} ${args}`, command)!.usage!, /^Usage:/u);
    }
  });
}

const skills = Array.from({ length: 17 }, (_, i) => ({
  name: `invoke_${i}`, skillName: `Skill ${i}`, description: `Description ${i}`,
}));
test("skill catalogue retains source eight-item paging", () => {
  assert.equal(SLASH_CATALOG_PAGE_SIZE, 8);
  const first = buildSkillsCatalogPage(skills);
  assert.equal(first.totalPages, 3);
  assert.match(first.text, /Skill 0 — Description 0/u);
  assert.match(first.text, /\/skill invoke_7 \[input\]/u);
  assert.doesNotMatch(first.text, /invoke_8/u);
  const second = buildSkillsCatalogPage(skills, 2);
  assert.match(second.text, /invoke_8/u);
  assert.match(second.text, /invoke_15/u);
  assert.doesNotMatch(second.text, /invoke_16/u);
});
test("skill catalogue clamps to last page", () => {
  const result = buildSkillsCatalogPage(skills, 100);
  assert.equal(result.currentPage, 3);
  assert.match(result.text, /invoke_16/u);
  assert.doesNotMatch(result.text, /invoke_15/u);
});
test("empty catalogue reports target-agent absence", () => {
  assert.deepEqual(buildSkillsCatalogPage([]), {
    text: "Available skills (1/1)\n\nNo skills available for this agent.", currentPage: 1, totalPages: 1,
  });
});
test("catalogue uses only supplied scoped inventory without mutation", () => {
  const snapshot = structuredClone(skills);
  const limited = Object.freeze([Object.freeze(skills[4])]);
  const result = buildSkillsCatalogPage(limited);
  assert.match(result.text, /invoke_4/u);
  assert.doesNotMatch(result.text, /invoke_3|invoke_5|More:/u);
  assert.deepEqual(skills, snapshot);
});
test("invalid renderer page uses first page", () => {
  for (const page of [NaN, Infinity, -1, 0, 1.5]) {
    assert.equal(buildSkillsCatalogPage(skills, page).currentPage, 1);
  }
});
test("actual registry exposes read-only catalogues with argument support", () => {
  const commands = buildBuiltinChatCommands();
  for (const key of ["commands", "skills"]) {
    const command = commands.find((entry) => entry.key === key)!;
    assert.ok(command);
    assert.equal(command.modelIndependent, "always");
    assert.equal(command.activeRunSafe, true);
    assert.equal(command.acceptsArgs, true);
    assert.equal(command.args?.[0].captureRemaining, true);
    assert.ok(command.textAliases.includes(`/${key}`));
    assert.equal(command.nativeName, key);
  }
  assert.equal(new Set(commands.flatMap((entry) => entry.textAliases)).size, commands.reduce((n, entry) => n + entry.textAliases.length, 0));
});
