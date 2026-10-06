import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { deployedUrlsFromOutput } from "../deployment.mjs";
import { runCommand } from "../run.mjs";

const RUN_MODULE = new URL("../run.mjs", import.meta.url).href;

// Runs a fake command through runCommand in a separate Node process, so its
// fd 1 writes can be observed as they happen. Resolves with every stdout chunk
// the wrapper wrote, each stamped with its arrival time, and the result.
function runFake(fakeScript, { capture = true } = {}) {
  const wrapper = `
    import { runCommand } from ${JSON.stringify(RUN_MODULE)};
    import { writeFileSync } from "node:fs";
    const result = await runCommand(process.execPath, ["-e", ${JSON.stringify(fakeScript)}], { cwd: process.cwd(), capture: ${capture} });
    writeFileSync(3, JSON.stringify({ ...result, error: result.error?.code }));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", wrapper], {
    stdio: ["ignore", "pipe", "inherit", "pipe"],
  });
  const writes = [];
  let resultJson = "";
  child.stdout.on("data", (chunk) => writes.push({ at: Date.now(), text: chunk.toString() }));
  child.stdio[3].on("data", (chunk) => {
    resultJson += chunk;
  });
  return new Promise((done) => {
    child.on("close", () => done({ writes, result: JSON.parse(resultJson) }));
  });
}

test("writes each stdout line to the log before the command exits", async () => {
  const { writes, result } = await runFake(
    'console.log("first"); setTimeout(() => console.log("second"), 500);',
  );
  const first = writes.find((w) => w.text.includes("first"));
  const second = writes.find((w) => w.text.includes("second"));
  assert.ok(first && second);
  assert.ok(!first.text.includes("second"), "first and second arrived in one write");
  assert.ok(second.at - first.at >= 300, `second arrived ${second.at - first.at}ms after first`);
  assert.equal(result.stdout, "first\nsecond\n");
  assert.equal(result.status, 0);
});

test("collects a result line split across writes and parses it as before", async () => {
  const line = JSON.stringify({
    kind: "result",
    envelope: {
      commandId: "deploy",
      result: {
        summary: {
          nodes: [{ address: "app", entities: [{ kind: "compute-service", url: "https://abc.ewr.prisma.build" }] }],
        },
      },
    },
  });
  const half = Math.floor(line.length / 2);
  const { writes, result } = await runFake(
    `process.stdout.write(${JSON.stringify(`deploying\n${line.slice(0, half)}`)});
     setTimeout(() => process.stdout.write(${JSON.stringify(line.slice(half))}), 200);`,
  );
  assert.equal(result.stdout, `deploying\n${line}`);
  assert.deepEqual(deployedUrlsFromOutput(result.stdout), {
    urls: { app: "https://abc.ewr.prisma.build" },
    url: "https://abc.ewr.prisma.build",
  });
  // The partial last line is ended in the log, but not in the collected stdout.
  assert.equal(writes.map((w) => w.text).join(""), `deploying\n${line}\n`);
});

test("returns the exit status of a failing command", async () => {
  const { result } = await runFake('console.log("boom"); process.exit(3);');
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "boom\n");
});

test("returns the signal of a killed command", async () => {
  const { result } = await runFake('process.kill(process.pid, "SIGTERM");');
  assert.equal(result.status, null);
  assert.equal(result.signal, "SIGTERM");
});

test("returns no stdout when output is not captured", async () => {
  const { writes, result } = await runFake('console.log("inherited");', { capture: false });
  assert.equal(result.stdout, "");
  assert.equal(writes.map((w) => w.text).join(""), "inherited\n");
});

test("returns the spawn error for a missing command", async () => {
  const result = await runCommand("no-such-command-for-run-test", [], { cwd: process.cwd(), capture: true });
  assert.equal(result.error?.code, "ENOENT");
  assert.equal(result.stdout, "");
});
