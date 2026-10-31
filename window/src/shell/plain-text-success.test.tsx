// @vitest-environment jsdom
// Issue 1814 follow-up (PR Closer's note on #2149): plainText() read every raw-looking line as a failure, so at Regular a
// success or neutral toast, banner or notice that names a file ("Saved to Downloads/report.pdf", a topic called
// "notes/plan.md") read as "That didn’t work. Try again." A line that is not a failure keeps its own words and names
// the file by its last part; a real failure still reads as one plain sentence.
import { afterEach, describe, expect, it } from "vitest";
import { clearBanner, currentBanner, raiseBanner } from "./Banner";
import { dismiss, getToasts, notify } from "./notify";
import { PLAIN_FAILURE, plainText } from "./plain-error";

const PATH = /\/[\w.-]|[\w-]\/[\w.-]|\\/;

afterEach(() => {
  for (const toast of getToasts()) dismiss(toast.id);
  clearBanner();
  localStorage.clear();
});

describe("success words keep their own words at Regular (issue 1814)", () => {
  it.each([
    ["Saved to Downloads/report.pdf", "Saved to report.pdf"],
    ["Saved to ./notes/today.md.", "Saved to today.md."],
    ["Wrote src/shell/plain-error.ts", "Wrote plain-error.ts"],
    ["Moved it to /data/branch/backups", "Moved it to backups"],
    ["Opened /srv.json", "Opened srv.json"],
    ["Exported to ~/Documents/branch-export.zip", "Exported to branch-export.zip"],
    ["Deleted \u201cnotes/plan.md\u201d.", "Deleted \u201cplan.md\u201d."],
    ["Backed up to /Users/alice", "Backed up to your home folder"],
    ["Saved to C:\\Users\\alice\\report.pdf", "Saved to report.pdf"],
  ])("plainText(%j) reads %j", (words, said) => {
    expect(plainText(words)).toBe(said);
    expect(plainText(words)).not.toMatch(PATH);
  });

  it("a plain toast that names a path is not the failure sentence", () => {
    notify("Sent \u201cFix window/src/shell/notify.ts\u201d to the board.");
    expect(getToasts().at(-1)?.text).toBe("Sent \u201cFix notify.ts\u201d to the board.");
    notify("Exported.", { line: "Saved to Downloads/report.pdf" });
    expect(getToasts().at(-1)?.line).toBe("Saved to report.pdf");
  });

  it("a banner that names a path keeps its words", () => {
    raiseBanner({ title: "Report ready", text: "Saved to Downloads/report.pdf" });
    expect(currentBanner()?.text).toBe("Saved to report.pdf");
    expect(currentBanner()?.text).not.toBe(PLAIN_FAILURE);
  });

  it("a real failure still reads plain, as a toast or a plain line", () => {
    notify("Couldn't save notes/today.md: EACCES: permission denied", { tone: "bad" });
    expect(getToasts().at(-1)?.text).toBe("Branch isn\u2019t allowed to do that here. Check the folder\u2019s permissions, then try again.");
    const said = plainText("Error: ENOENT: no such file or directory, open '/Users/alice/notes/today.md'");
    expect(said).not.toMatch(/ENOENT|alice|today\.md/);
    expect(plainText("TypeError: Cannot read properties of undefined (reading 'x')")).toBe(PLAIN_FAILURE);
  });

  it("Advanced keeps the exact words", () => {
    localStorage.setItem("branch.level", "advanced");
    expect(plainText("Saved to Downloads/report.pdf")).toBe("Saved to Downloads/report.pdf");
  });
});
