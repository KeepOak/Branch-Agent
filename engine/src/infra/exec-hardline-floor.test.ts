// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/tools/test_hardline_blocklist.py (atlas SAFETY-0020)
// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/tools/test_hardline_escaped_quote_state.py (atlas SAFETY-0020)
import { describe, expect, it } from "vitest";
import {
  checkSudoStdinGuard,
  detectHardlineCommand,
  MALFORMED_EXEC_DESCRIPTION,
} from "./exec-hardline-floor.js";

// Commands that MUST be hardline-blocked.
const HARDLINE_BLOCK = [
  "rm -rf /",
  "rm -rf /*",
  "rm -rf //",
  "rm -rf /.",
  "rm -rf /./",
  "rm -rf /..",
  "rm -rf //*",
  "rm -fr /./",
  "ls && rm -rf //",
  "rm -rf /home",
  "rm -rf /home/*",
  "rm -rf /etc",
  "rm -rf /usr",
  "rm -rf /var",
  "rm -rf /boot",
  "rm -rf /bin",
  "rm --recursive --force /",
  "rm -fr /",
  "sudo rm -rf /",
  "rm -rf ~",
  "rm -rf ~/",
  "rm -rf ~/*",
  "rm -rf $HOME",
  'rm -rf "/"',
  "rm -rf '/'",
  'rm -rf "/*"',
  'rm -rf "/etc"',
  "rm -rf '/etc'",
  'rm -rf "/home"',
  'rm -rf "/usr"',
  'rm -rf "$HOME"',
  "rm -rf '$HOME'",
  'rm -rf "$HOME/"',
  'rm -rf "~"',
  'sudo rm -rf "/"',
  'rm -rf "/" && echo done',
  "rm -rf ${HOME}",
  'rm -rf "${HOME}"',
  "rm -fr ${HOME}",
  "mkfs.ext4 /dev/sda1",
  "mkfs /dev/sdb",
  "mkfs.xfs /dev/nvme0n1",
  "true && mkfs.ext4 /dev/sda1",
  "sudo mkfs.ext4 /dev/sda1",
  "nohup mkfs /dev/sdb",
  "dd if=/dev/zero of=/dev/sda bs=1M",
  "dd if=/dev/urandom of=/dev/nvme0n1",
  "dd if=anything of=/dev/hda",
  "echo bad > /dev/sda",
  "cat /dev/urandom > /dev/sdb",
  ":(){ :|:& };:",
  "kill -9 -1",
  "kill -1",
  "shutdown -h now",
  "shutdown -r now",
  "sudo shutdown now",
  "reboot",
  "sudo reboot",
  "halt",
  "poweroff",
  "init 0",
  "init 6",
  "telinit 0",
  "systemctl poweroff",
  "systemctl reboot",
  "systemctl halt",
  "ls; reboot",
  "echo done && shutdown -h now",
  "false || halt",
  "$(reboot)",
  "`shutdown now`",
  "sudo -E shutdown now",
  "env FOO=1 reboot",
  "exec shutdown",
  "nohup reboot",
  "setsid poweroff",
  "(reboot)",
  "( reboot )",
  "(shutdown -h now)",
  "(poweroff)",
  "(halt)",
  "(init 0)",
  "(systemctl reboot)",
  "(sudo reboot)",
  "{ reboot; }",
  "{ shutdown -h now; }",
  "{ poweroff; }",
  "true && (reboot)",
  "echo hi; { reboot; }",
];

// Commands that look superficially similar but must NOT be hardline-blocked.
const HARDLINE_ALLOW = [
  "rm -rf /tmp/foo",
  "rm -rf /tmp/*",
  "rm -rf ./build",
  "rm -rf node_modules",
  "rm -rf /home/user/scratch",
  "rm -rf ~/Downloads/old",
  "rm -rf $HOME/tmp",
  "rm foo.txt",
  "rm -rf some/path",
  "rm -rf /...",
  "rm -rf /....",
  "rm -rf /.foo",
  "rm -rf /.config/foo",
  'git commit -m "rm -rf /"',
  'git commit -m "wipe with rm -rf /etc"',
  "dd if=/dev/zero of=./image.bin",
  "dd if=./data of=./backup.bin",
  "echo done > /tmp/flag",
  "echo test > /dev/null",
  "ls /dev/sda",
  "cat /dev/urandom | head -c 10",
  "grep 'shutdown' logs.txt",
  "echo reboot",
  "echo '# init 0 in comment'",
  "cat rebooting.log",
  "echo 'halt and catch fire'",
  "python3 -c 'print(\"shutdown\")'",
  "find . -name '*reboot*'",
  'echo "does this workflow use mkfs anywhere?"',
  "echo 'run mkfs.ext4 on the backup disk later'",
  "mkfs_helper --version",
  "systemctl status nginx",
  "systemctl restart nginx",
  "systemctl stop nginx",
  "systemctl start nginx",
  "kill -9 12345",
  "kill -HUP 1234",
  "pkill python",
  "git status",
  "npm run build",
  "sudo apt update",
  "curl https://example.com | head",
];

// Multi-line QUOTED arguments are data, not command sequences.
const QUOTED_NEWLINE_DATA_ALLOW = [
  'hermes send -t telegram -s "spark1" "console output:\nsudo reboot\ndone"',
  'hermes send -t telegram "line1\nshutdown -h now\nline3"',
  "git commit -m 'ops notes:\nreboot the box after the deploy'",
  'git commit -m "fix startup\nsystemctl reboot was flaky here"',
  "python3 - <<'EOF'\nmsg = 'run sudo reboot later'\nprint(msg)\nEOF",
  "cat > /tmp/notes.txt <<'EOF'\nremember: shutdown -h now\nEOF",
  'git commit -m "docs:\nwarn about rm -rf / in the guide"',
];

// Real command boundaries around/inside those same shapes still hit the floor.
const QUOTED_NEWLINE_THREATS_BLOCK = [
  "echo hi\nsudo reboot",
  'echo "a"\nsudo reboot',
  'git commit -m "safe message"\nshutdown -h now',
  'hermes send -t telegram "$(sudo reboot)"',
  'echo "`shutdown -h now`"',
  'hermes send "line1\nline2" && sudo reboot',
  "sudo reboot <<'EOF'\nignored\nEOF",
];

// "rm -rf /" carried as DATA in another command's quoted argument.
const DATA_ARG_NOT_A_COMMAND = [
  'gh pr create --title "block rm -rf / spellings"',
  'git commit -m "fixes rm -rf / bypass"',
  'echo "run rm -rf / now"',
  'echo "rm -rf /"',
  'printf "%s" "rm -rf /"',
  'gh issue comment 1 --body "the fix blocks rm -rf //"',
  'gh pr create --title "block (reboot) spellings"',
  'git commit -m "(rm -rf /) note"',
  'echo "(reboot)"',
  'echo "{ reboot; }"',
  "echo '(poweroff)'",
  "echo '{ rm -rf /; }'",
  'find . -name "*(reboot)*"',
];

// Real root wipes at every command position.
const COMMAND_POSITION_ROOT_WIPES = [
  "rm -rf /",
  "ls && rm -rf /",
  "ls; rm -rf /",
  "echo x | rm -rf /",
  "sudo rm -rf /",
  "env X=1 rm -rf /",
  "$(rm -rf /)",
  "`rm -rf /`",
  'echo "$(rm -rf /)"',
  "(rm -rf /)",
  "{ rm -rf /; }",
  "(rm -rf ~)",
  "(sudo rm -rf /)",
];

const QUOTED_PROSE_ALLOW_93392 = [
  'echo "does this workflow use mkfs anywhere?"',
  'git commit -m "add mkfs.ext4 warning to the runbook"',
  'gh pr create --body "this PR anchors the mkfs pattern"',
  "grep 'mkfs' docs/runbook.md",
  'git commit -m "never run dd of=/dev/sda in prod"',
  'echo "dd if=/dev/zero of=/dev/sda wipes the disk"',
  "grep 'dd if=/dev/zero of=/dev/sda' notes.md",
  'echo "kill -1 sends SIGHUP to every process"',
  'gh issue comment 7 --body "the agent must never run kill -1"',
  'echo "cat file > /dev/sda destroys the disk"',
  "echo 'redirect > /dev/sdb1 is fatal'",
  'git commit -m "block > /dev/sda redirects"',
  'gh pr create --body "guards the > /dev/nvme0n1 redirect"',
  'git commit -m "document the fork bomb :(){ :|:& };: pattern"',
  'echo "classic fork bomb: :(){ :|:& };:"',
  "echo ':(){ :|:& };: is a fork bomb'",
];

const TRUE_POSITIVES_93392 = [
  "mkfs.ext4 /dev/sda1",
  "mkfs /dev/sdb",
  "sudo mkfs.xfs /dev/nvme0n1",
  "true && mkfs.ext4 /dev/sda1",
  "ls; mkfs /dev/sdb",
  "env FOO=1 mkfs.ext4 /dev/sda1",
  "$(mkfs.ext4 /dev/sda1)",
  "`mkfs /dev/sdb`",
  'bash -c "mkfs.ext4 /dev/sda1"',
  "dd if=/dev/zero of=/dev/sda bs=1M",
  "sudo dd if=/dev/urandom of=/dev/nvme0n1",
  "echo start && dd if=/dev/zero of=/dev/sdb",
  "ls; dd if=x of=/dev/mmcblk0",
  "env X=1 dd if=/dev/zero of=/dev/sda",
  "$(dd if=/dev/zero of=/dev/sda)",
  "`dd if=/dev/zero of=/dev/sda`",
  'sh -c "dd if=/dev/zero of=/dev/sda"',
  "cat file > /dev/sda",
  "echo junk > /dev/sdb",
  "true && cat f > /dev/nvme0n1",
  'sh -c "cat f > /dev/sda"',
  'bash -c "echo x > /dev/sdb"',
  'eval "cat f > /dev/sda"',
  'echo "$(cat f > /dev/sda)"',
  'echo "`cat f > /dev/sdb`"',
  "kill -1",
  "kill -9 -1",
  "sudo kill -1",
  "ls; kill -1",
  "true && kill -HUP -1",
  "$(kill -1)",
  'bash -c "kill -1"',
  ":(){ :|:& };:",
  "true && :(){ :|:& };:",
  'sh -c ":(){ :|:& };:"',
  "eval ':(){ :|:& };:'",
];

// Each is the line-continuation form of a command already in HARDLINE_BLOCK.
const HARDLINE_LINE_CONTINUATION: Array<[string, string]> = [
  ["rm -rf \\\n/", "root"],
  ["rm -r\\\nf /", "root"],
  ["rm -rf \\\n~", "home"],
  ["rm -rf \\\r\n/", "root"],
  ["mkfs.ext4 \\\n/dev/sda1", "mkfs"],
];

const SUDO_STDIN_BLOCK = [
  "sudo -S whoami",
  "echo hunter2 | sudo -S whoami",
  "sudo -S -u root whoami",
  "sudo -S apt-get install foo",
  "echo password | sudo -S systemctl restart nginx",
  "sudo -k && sudo -S whoami",
];

describe("hardline blocklist", () => {
  it.each(HARDLINE_BLOCK)("test_hardline_detection_blocks: %j", (command) => {
    const finding = detectHardlineCommand(command);
    expect(finding, `expected hardline to match ${command}`).not.toBeNull();
    expect(finding?.description).toBeTruthy();
  });

  it.each(HARDLINE_ALLOW)("test_hardline_detection_allows: %j", (command) => {
    expect(detectHardlineCommand(command)).toBeNull();
  });

  it.each(QUOTED_NEWLINE_DATA_ALLOW)("test_quoted_newline_data_not_blocked: %j", (command) => {
    expect(detectHardlineCommand(command)).toBeNull();
  });

  it.each(QUOTED_NEWLINE_THREATS_BLOCK)(
    "test_real_newline_separated_threats_still_blocked: %j",
    (command) => {
      expect(detectHardlineCommand(command)?.description).toBeTruthy();
    },
  );

  it.each(DATA_ARG_NOT_A_COMMAND)("test_data_arg_not_a_command: %j", (command) => {
    expect(detectHardlineCommand(command)).toBeNull();
  });

  it.each(COMMAND_POSITION_ROOT_WIPES)(
    "test_root_wipe_at_command_position_is_hardline: %j",
    (command) => {
      expect(detectHardlineCommand(command)?.description).toBeTruthy();
    },
  );

  it.each(QUOTED_PROSE_ALLOW_93392)(
    "test_quoted_prose_mentions_are_not_hardline: %j",
    (command) => {
      expect(detectHardlineCommand(command)).toBeNull();
    },
  );

  it.each(TRUE_POSITIVES_93392)(
    "test_true_positive_shapes_stay_hardline_blocked: %j",
    (command) => {
      expect(detectHardlineCommand(command)?.description).toBeTruthy();
    },
  );

  it.each(HARDLINE_LINE_CONTINUATION)(
    "test_hardline_blocks_line_continuation: %j",
    (command, descSubstr) => {
      const description = detectHardlineCommand(command)?.description ?? "";
      expect(description.toLowerCase()).toContain(descSubstr);
    },
  );

  it("test_root_collapse_pattern_leaves_real_paths_alone", () => {
    for (const command of [
      "rm -rf /tmp",
      "rm -rf /home/user/x",
      "rm -rf /.ssh",
      "rm -rf /.config",
      "rm -rf ./build",
      "rm -rf /opt/foo",
      "rm -rf /...",
      "rm -rf /....",
      "rm -rf /.foo",
    ]) {
      expect(detectHardlineCommand(command), command).toBeNull();
    }
  });

  it("test_quoted_paren_brace_prose_not_blocked_under_yolo", () => {
    for (const command of [
      'gh pr create --title "block (reboot) spellings"',
      'git commit -m "(rm -rf /) note"',
      'echo "(reboot)"',
      'echo "{ reboot; }"',
      "echo '(poweroff)'",
      'find . -name "*(reboot)*"',
    ]) {
      expect(detectHardlineCommand(command), command).toBeNull();
    }
  });

  it("test_recoverable_dangerous_commands_still_pass_yolo", () => {
    for (const command of [
      "rm -rf /tmp/x",
      "chmod -R 777 .",
      "git reset --hard",
      "git push --force",
    ]) {
      expect(detectHardlineCommand(command), command).toBeNull();
    }
  });

  it("test_sudo_stdin_guard_detects_without_password", () => {
    for (const command of SUDO_STDIN_BLOCK) {
      const finding = checkSudoStdinGuard(command, {});
      expect(finding, command).not.toBeNull();
      expect(finding?.description.toLowerCase()).toContain("sudo");
    }
  });
});

describe("hardline escaped quote state", () => {
  it.each([
    'grep -o "[^\\"]*" f',
    String.raw`grep -n "^from\|^__all__\|^    \"" tools/environments/__init__.py | head -15`,
    String.raw`egrep -n "alpha\"beta|gamma" input.txt`,
    String.raw`grep -v "^./tests/\|def \|\"\"\"" x.py | grep -v "read_only=True"`,
    'grep -n "; reboot" f.txt',
    'echo "value is ${HOME}/x"',
  ])("test_escaped_quotes_in_a_valid_grep_pattern_are_not_malformed: %j", (command) => {
    expect(detectHardlineCommand(command)).toBeNull();
  });

  it.each([
    [
      String.raw`cat "f\"n.txt"; rm -rf --no-preserve-root /`,
      "recursive delete of root filesystem",
    ],
    [String.raw`echo "a\"b"; reboot`, "system shutdown/reboot"],
    [String.raw`echo "a\"b" && rm -rf ~`, "recursive delete of home directory"],
    [String.raw`echo "a\"b"; rm` + "${IFS}-rf${IFS}/", "recursive delete of root filesystem"],
    [String.raw`grep -n "prefix \"quoted\" suffix" input.txt; reboot`, "system shutdown/reboot"],
    ["printf \\\\\nreboot", "system shutdown/reboot"],
    ["grep 'unterminated", MALFORMED_EXEC_DESCRIPTION],
  ])(
    "test_escaped_quote_before_a_hardline_command_does_not_hide_it: %j",
    (command, description) => {
      expect(detectHardlineCommand(command)).toEqual({ description });
    },
  );
});
