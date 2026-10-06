import { spawn } from "node:child_process";
import { writeSync } from "node:fs";

/**
 * Runs a command and resolves once it has exited. An argv array never
 * touches a shell; a string command (args null) runs through one verbatim.
 *
 * With `capture`, stdout is piped: each chunk is written to the job log as it
 * arrives and also collected, so the caller can parse the full output. stdin
 * and stderr stay inherited, so the child writes them to the log directly.
 *
 * @returns {Promise<{ status?: number | null, signal?: string | null, error?: Error, stdout: string }>}
 */
export async function runCommand(command, args, { cwd, capture = false }) {
  const options = { cwd, stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit" };
  const child = args ? spawn(command, args, options) : spawn(command, { ...options, shell: true });
  const chunks = [];
  child.stdout?.on("data", (chunk) => {
    chunks.push(chunk);
    writeSync(1, chunk);
  });
  // A spawn failure emits "error" and then "close"; the first event wins.
  const result = await new Promise((done) => {
    child.on("error", (error) => done({ error }));
    child.on("close", (status, signal) => done({ status, signal }));
  });
  const stdout = Buffer.concat(chunks).toString();
  // Ends a partial last line so the next log line, such as ::endgroup::, starts on its own line.
  if (stdout && !stdout.endsWith("\n")) writeSync(1, "\n");
  return { ...result, stdout };
}
