import { environment } from "./environment.ts";
import { basename, dirname, join } from "@std/path";
import $ from "@david/dax";

import {
  Bash,
  Fish,
  Posix,
  type ShellScript,
  shEnvScript,
  shSourceString,
  type SourceStringInfo,
  type UnixShell,
  Zsh,
} from "./shell.ts";
import {
  ensureEndsWith,
  ensureExists,
  ensureStartsWith,
  warn,
  withContext,
} from "./util.ts";
const {
  readTextFile,
  runCmd,
  writeTextFile,
} = environment;

type CompletionWriteResult = "fail" | "success" | null;

async function writeCompletionFiles(
  availableShells: UnixShell[],
): Promise<CompletionWriteResult[]> {
  const written = new Set<string>();
  const results: CompletionWriteResult[] = [];

  const decoder = new TextDecoder();

  for (const shell of availableShells) {
    if (!shell.supportsCompletion) {
      results.push(null);
      continue;
    }

    try {
      const completionFilePath = await shell.completionsFilePath?.();
      if (!completionFilePath) {
        results.push(null);
        continue;
      }
      await ensureExists(dirname(completionFilePath));
      const output = await runCmd(Deno.execPath(), ["completions", shell.name]);
      if (!output.success) {
        throw new Error(
          `deno completions subcommand failed, stderr was: ${
            decoder.decode(output.stderr)
          }`,
        );
      }
      const completionFileContents = decoder.decode(output.stdout);
      if (!completionFileContents) {
        warn(`Completions were empty, skipping ${shell.name}`);
        results.push("fail");
        continue;
      }
      let currentContents = null;
      try {
        currentContents = await readTextFile(completionFilePath);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        } else {
          // nothing
        }
      }
      if (currentContents !== completionFileContents) {
        if (currentContents !== null) {
          warn(
            `an existing completion file for deno already exists at ${completionFilePath}, but is out of date. overwriting with new contents`,
          );
        }
        await writeTextFile(completionFilePath, completionFileContents);
      }
      results.push("success");
      written.add(completionFilePath);
    } catch (error) {
      warn(`Failed to install completions for ${shell.name}: ${error}`);
      results.push("fail");
      continue;
    }
  }
  return results;
}

class Backups {
  backedUp = new Set<string>();
  constructor(public backupDir: string, public backupContext?: string) {}

  async add(path: string, contents: string): Promise<void> {
    if (this.backedUp.has(path)) {
      return;
    }
    const dest = join(this.backupDir, basename(path)) + `.bak`;
    console.log(
      `%cinfo%c: backing '${path}' up to '${dest}'`,
      "color: green",
      "color: inherit",
    );
    await Deno.writeTextFile(dest, contents);
    this.backedUp.add(path);
  }
}

async function writeCompletionRcCommands(
  availableShells: UnixShell[],
  backups: Backups,
) {
  for (const shell of availableShells) {
    if (!shell.supportsCompletion) continue;

    const rcCmd = await shell.completionsSourceString?.();
    if (!rcCmd) continue;

    for (const rc of await shell.rcsToUpdate()) {
      await updateRcFile(rc, rcCmd, backups);
    }
  }
}

async function writeEnvFiles(availableShells: UnixShell[], installDir: string) {
  const written = new Array<ShellScript>();

  let i = 0;
  while (i < availableShells.length) {
    const shell = availableShells[i];
    const script = (shell.envScript ?? shEnvScript)(installDir);

    if (!written.some((s) => s.equals(script))) {
      if (await script.write(installDir)) {
        written.push(script);
      } else {
        continue;
      }
    }

    i++;
  }
}

async function updateRcFile(
  rc: string,
  sourceString: string | SourceStringInfo,
  backups: Backups,
): Promise<boolean> {
  let prepend: string = "";
  let append: string = "";
  if (typeof sourceString === "string") {
    append = sourceString;
  } else {
    prepend = sourceString.prepend ?? "";
    append = sourceString.append ?? "";
  }
  if (!prepend && !append) {
    return false;
  }

  let contents: string | undefined;
  try {
    contents = await readTextFile(rc);
    if (prepend) {
      if (contents.includes(prepend)) {
        // nothing to prepend
        prepend = "";
      } else {
        // always add a newline
        prepend = ensureEndsWith(prepend, "\n");
      }
    }
    if (append) {
      if (contents.includes(append)) {
        // nothing to append
        append = "";
      } else if (!contents.endsWith("\n")) {
        // add new line to start
        append = ensureStartsWith(append, "\n");
      }
    }
  } catch (_error) {
    prepend = prepend ? ensureEndsWith(prepend, "\n") : prepend;
    append = append ? ensureStartsWith(append, "\n") : append;
  }
  if (!prepend && !append) {
    return false;
  }

  if (contents !== undefined) {
    await backups.add(rc, contents);
  }

  await ensureExists(dirname(rc));

  try {
    await writeTextFile(rc, prepend + (contents ?? "") + append, {
      create: true,
    });

    return true;
  } catch (error) {
    if (error instanceof Deno.errors.PermissionDenied) {
      return false;
    }
    throw withContext(`Failed to amend shell rc file: ${rc}`, error);
  }
}

async function addToPath(
  availableShells: UnixShell[],
  installDir: string,
  backups: Backups,
) {
  for (const shell of availableShells) {
    const sourceCmd = await (shell.sourceString ?? shSourceString)(installDir);

    for (const rc of await shell.rcsToUpdate()) {
      await updateRcFile(rc, sourceCmd, backups);
    }
  }
}

// Update this when adding support for a new shell
const shells: UnixShell[] = [
  new Posix(),
  new Bash(),
  new Zsh(),
  new Fish(),
];

async function getAvailableShells(): Promise<UnixShell[]> {
  const present = [];
  for (const shell of shells) {
    if (await shell.exists()) {
      present.push(shell);
    }
  }
  return present;
}

async function setupShells(installDir: string, backupDir: string) {
  const availableShells = await getAvailableShells();

  await writeEnvFiles(availableShells, installDir);

  const backups = new Backups(backupDir);

  if (
    await $.confirm(`Edit shell configs to add deno to the PATH?`, {
      default: false,
    })
  ) {
    await ensureExists(backupDir);
    await addToPath(availableShells, installDir, backups);
  }

  const shellsWithCompletion = availableShells.filter((s) =>
    s.supportsCompletion !== false
  );
  const selected = await $.multiSelect(
    {
      message: `Set up completions?`,
      options: shellsWithCompletion.map((s) => {
        const maybeNotes = typeof s.supportsCompletion === "string"
          ? ` (${s.supportsCompletion})`
          : "";
        return s.name +
          maybeNotes;
      }),
    },
  );
  const completionsToSetup = selected.map((idx) => shellsWithCompletion[idx]);

  if (
    completionsToSetup.length > 0
  ) {
    await ensureExists(backupDir);
    const results = await writeCompletionFiles(completionsToSetup);
    await writeCompletionRcCommands(
      completionsToSetup.filter((_s, i) => results[i] !== "fail"),
      backups,
    );
  }
}

async function main() {
  if (Deno.build.os === "windows" || !Deno.stdin.isTerminal()) {
    // the powershell script already handles setting up the path
    return;
  }

  if (Deno.args.length === 0) {
    throw new Error(
      "Expected the deno install directory as the first argument",
    );
  }

  const installDir = Deno.args[0].trim();

  const backupDir = join(installDir, ".shellRcBackups");
  await setupShells(installDir, backupDir);
}

if (import.meta.main) {
  await main();
}
