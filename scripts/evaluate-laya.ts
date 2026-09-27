import { execFileSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildTrials, evaluateTrial, summarize, type Result } from "./laya-eval.ts";

async function main() {
  const { values } = parseArgs({ options: {
    "base-url": { type: "string", default: "http://127.0.0.1:8000" },
    repeat: { type: "string", default: "1" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  } });
  if (values.help) {
    console.log("pnpm test:laya [--dry-run] [--base-url http://127.0.0.1:8000] [--repeat 1..10] [--out report.json]\nCalls the real local Laya server. Optional LAYA_API_KEY is read from the environment. No game server required.");
    return;
  }
  const trials = buildTrials(Number(values.repeat));
  const url = new URL(values["base-url"]);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("base-url must be an HTTP(S) URL without credentials, query, or fragment");
  }
  const endpoint = `${url.href.replace(/\/$/, "")}/v1/systemone`;
  const startedAt = new Date().toISOString();
  const out = resolve(values.out ?? `eval-results/laya-${startedAt.replace(/[:.]/g, "-")}.json`);
  // Fail before making requests if the report cannot be created; never overwrite a previous run.
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, "", { flag: "wx" });
  let gitCommit: string | null = null;
  try { gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* source archive */ }
  const results: Result[] = [];
  const save = async () => {
    const temporary = `${out}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({
      schemaVersion: 1, startedAt, updatedAt: new Date().toISOString(), gitCommit,
      endpoint, model: "english", strategy: "greedy", dryRun: values["dry-run"],
      planned: trials.length, completed: results.length,
      summary: summarize(results), results,
      ...(values["dry-run"] ? { trials } : {}),
    }, null, 2) + "\n");
    await rename(temporary, out);
  };
  await save();
  console.log(`${trials.length} requests; 20 boards; all option permutations; ${values.repeat} repeat(s).`);
  console.log(`Report: ${out}`);
  if (values["dry-run"]) {
    console.log("Dry run: fixtures and exact request payloads saved; no network requests made.");
    return;
  }
  console.log(`Calling ${endpoint} directly (model=english).`);
  for (const trial of trials) {
    const result = await evaluateTrial(trial, endpoint, process.env.LAYA_API_KEY ?? "");
    results.push(result);
    await save(); // Preserve completed requests if the user stops the run.
    console.log(`[${results.length}/${trials.length}] ${result.status.toUpperCase()} ${trial.id}: expected=${trial.expectedChoice} actual=${result.choice ?? result.error} (${result.latencyMs} ms)`);
    if (result.errorKind === "network" || result.httpStatus === 401 || result.httpStatus === 403) {
      console.error("Stopped on connectivity/authentication failure; partial report saved.");
      break;
    }
  }
  const summary = summarize(results);
  console.table(summary.byFamily);
  console.log(`Correct: ${summary.correct}/${summary.valid} valid responses; errors: ${summary.errors}; completed: ${results.length}/${trials.length}.`);
  console.log(`Option-order changes: ${summary.orderSensitivity.changedGroups}/${summary.orderSensitivity.comparableGroups} complete case/repeat groups.`);
  // Both failed expectations and service errors fail the integration suite.
  if (summary.wrong || summary.errors) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
