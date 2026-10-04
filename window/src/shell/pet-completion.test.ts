import { expect, it } from "vitest";
import { PetCompletion } from "./pet-completion";
const active = { sessionKey:"main", liveRunId:"run1", doneAt:null };
const done = { ...active, liveRunId:null, doneAt:100 };
it("cheers an observed successful lifecycle only after its native doneAt settles and only once", () => {
  const completion = new PetCompletion(active);
  completion.record("agent", { runId:"run1", seq:9, stream:"lifecycle", data:{ phase:"end" } }, active);
  expect(completion.advance(active)).toBe(false);
  expect(completion.advance(done)).toBe(true);
  expect(completion.advance(done)).toBe(false);
});
it.each(["error", "aborted"])("does not cheer chat %s even though it advances doneAt", state => {
  const completion = new PetCompletion(active);
  completion.record("chat", { runId:"run1", state }, active);
  expect(completion.advance(done)).toBe(false);
});
it("does not celebrate mounting on old completion or unrelated/session-switched completions", () => {
  expect(new PetCompletion(done).advance(done)).toBe(false);
  const completion = new PetCompletion(active);
  completion.record("chat", { runId:"run2", state:"final" }, active);
  expect(completion.advance(done)).toBe(false);
  completion.record("chat", { runId:"run1", state:"final" }, active);
  expect(completion.advance({ ...done, sessionKey:"other" })).toBe(false);
});
it("does not infer success from doneAt without a native final event", () => {
  expect(new PetCompletion(active).advance(done)).toBe(false);
});
it("discards a pending successful receipt when a newer run takes over before settling", () => {
  const completion = new PetCompletion(active);
  completion.record("chat", { runId:"run1", state:"final" }, active);
  completion.advance({ ...active, liveRunId:"run2" });
  expect(completion.advance(done)).toBe(false);
});
it("ignores stale lifecycle events and retains an observed failure over a later chat final", () => {
  const success = new PetCompletion(active);
  success.record("agent", { runId:"run1", seq:9, stream:"lifecycle", data:{ phase:"end" } }, active);
  success.record("agent", { runId:"run1", seq:8, stream:"lifecycle", data:{ phase:"error" } }, active);
  expect(success.advance(done)).toBe(true);
  const failure = new PetCompletion(active);
  failure.record("agent", { runId:"run1", seq:9, stream:"lifecycle", data:{ phase:"error" } }, active);
  failure.record("chat", { runId:"run1", state:"final" }, active);
  expect(failure.advance(done)).toBe(false);
});
it("retains a native aborted receipt over a later lifecycle end for that run", () => {
  const completion = new PetCompletion(active);
  completion.record("chat", { runId:"run1", state:"aborted" }, active);
  completion.record("agent", { runId:"run1", seq:9, stream:"lifecycle", data:{ phase:"end" } }, active);
  expect(completion.advance(done)).toBe(false);
});
