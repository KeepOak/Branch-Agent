// One case per bypass named in the PR #1278 security review and the follow-up independent review.
// Each case only calls detectExecHardlineFloor on a string; nothing here runs a command.
import { describe, expect, it } from "vitest";
import { detectExecHardlineFloor } from "./exec-hardline-floor.js";
import { normalizeFloorPath } from "./exec-hardline-structural.js";

// base64 of "rm -rf /etc"; only decoded by the reader of this file, never by a shell.
const B64 = "cm0gLXJmIC9ldGM=";

// Review finding 2 / ruling 1: command-word prefixes, wrappers and segment splitting.
const COMMAND_WORD_BYPASSES = [
  "/bin/rm -rf /",
  "/usr/bin/rm -rf /",
  "/bin/rm -rf /etc",
  "FOO=1 rm -rf /",
  "command rm -rf /",
  "sudo -u root rm -rf /",
  "true && /bin/rm -rf /",
  "bash -c '/bin/rm -rf /'",
  "eval 'reboot'",
  "eval reboot",
  "exec /sbin/reboot",
  "env -i PATH=/bin /bin/rm -rf /etc",
  "false || /usr/sbin/shutdown -h now",
  "echo hi | /bin/rm -rf /",
  "zsh -c 'command /bin/rm -rf /usr'",
];

// Review finding 3 / ruling 2: path spellings that collapse onto a protected root.
const PATH_FORM_BYPASSES = [
  "rm -rf /etc/",
  'rm -rf "/etc/"',
  "echo ok && rm -rf /etc/",
  "echo ok; rm -rf /etc/",
  'sh -c "rm -rf /etc/"',
  "rm -rf /usr/",
  "rm -rf /home/",
  "rm -rf /var/",
  "rm -rf /etc/.",
  "rm -rf /tmp/../etc",
  "rm -rf /tmp/../*",
  "rm -rf /tmp/x/../../",
  "rm -rf /usr//",
  "rm -rf /usr/./",
  "rm -rf /home/runner",
];

// Review finding 4 / ruling 3: targets and payloads the text rules cannot see.
const INDIRECTION_BYPASSES = [
  "D=/etc; rm -rf $D",
  "python3 -c \"import shutil; shutil.rmtree('/etc')\"",
  "perl -e 'system(q{rm -rf /etc})'",
  "find / -maxdepth 1 -exec rm -rf {} +",
  "xargs -0 rm -rf < list",
  "echo " + B64 + " | base64 -d | sh",
  'eval "$(echo ' + B64 + ' | base64 -d)"',
  "git -c core.sshCommand='rm -rf /' fetch",
  'rm -rf "$(cat target.txt)"',
  "rm -rf \x60cat target.txt\x60",
  "echo 'rm -rf /etc' | sh",
  "node -e \"require('fs').rmSync('/etc', { recursive: true })\"",
];

// Review finding 5 / ruling 4: macOS roots, disks and the bare home path.
const MACOS_BYPASSES = [
  "rm -rf /Users",
  "rm -rf /Library",
  "rm -rf /Applications",
  "rm -rf /System",
  "rm -rf /private/etc",
  "rm -rf /private/var",
  "rm -rf /System/Volumes/Data",
  "rm -rf /Users/someone",
  "diskutil eraseDisk JHFS+ X /dev/disk2",
  "diskutil eraseVolume APFS X disk2s1",
  "dd if=/dev/zero of=/dev/disk2",
  "dd if=/dev/zero of=/dev/rdisk2 bs=1m",
  "newfs_hfs /dev/disk2",
  "newfs_apfs /dev/disk2s1",
  "asr restore --source a.dmg --target /Volumes/X --erase",
  "cat image > /dev/disk2",
];

// Shapes that must stay unprompted so full access remains usable.
const STILL_ALLOWED = [
  "rm -rf /tmp/build",
  "rm -rf $HOME/tmp",
  "rm -rf ~/Downloads/old",
  "rm -rf /Users/someone/project/build",
  "rm -rf ./dist node_modules",
  "find . -name '*.pyc' -exec rm -f {} +",
  "find /tmp/cache -type d -exec rm -rf {} +",
  "git ls-files | xargs grep TODO",
  "python3 -c 'import os; print(os.getcwd())'",
  "diskutil list",
  "dd if=/dev/disk2 of=./backup.img",
  "git -c user.name=x commit -m 'rm -rf / note'",
  "command -v rm",
  "echo cm0= | base64 -d",
];

describe("security review bypasses (PR #1278)", () => {
  it.each(COMMAND_WORD_BYPASSES)("command word is normalized before matching: %j", (command) => {
    expect(detectExecHardlineFloor(command), command).not.toBeNull();
  });

  it.each(PATH_FORM_BYPASSES)("path operand is normalized before matching: %j", (command) => {
    expect(detectExecHardlineFloor(command), command).not.toBeNull();
  });

  it.each(INDIRECTION_BYPASSES)("unseen target or payload asks: %j", (command) => {
    expect(detectExecHardlineFloor(command), command).not.toBeNull();
  });

  it.each(MACOS_BYPASSES)("macOS root or disk asks: %j", (command) => {
    expect(detectExecHardlineFloor(command), command).not.toBeNull();
  });

  it.each(STILL_ALLOWED)("ordinary command stays unprompted: %j", (command) => {
    expect(detectExecHardlineFloor(command), command).toBeNull();
  });

  it.each([
    ["/usr//", "/usr"],
    ["/etc/.", "/etc"],
    ["/tmp/../etc", "/etc"],
    ["/tmp/x/../../", "/"],
    ["/tmp/../*", "/"],
    ["/usr/./", "/usr"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeFloorPath(input)).toBe(expected);
  });
});
