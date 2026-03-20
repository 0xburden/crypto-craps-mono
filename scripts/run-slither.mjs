import { mkdir, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import { delimiter } from "node:path";

const outputDir = "audit/reports";
const outputPath = process.env.SLITHER_REPORT_PATH ?? `${outputDir}/slither-report.json`;

async function hasCommand(command) {
  const paths = (process.env.PATH ?? "").split(delimiter);
  for (const entry of paths) {
    if (!entry) continue;
    try {
      await access(`${entry}/${command}`, fsConstants.X_OK);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function summarizeDetectors(detectors) {
  const counts = {
    High: 0,
    Medium: 0,
    Low: 0,
    Informational: 0,
    Optimization: 0
  };

  for (const detector of detectors) {
    const impact = detector.impact ?? "Informational";
    if (!(impact in counts)) {
      counts[impact] = 0;
    }
    counts[impact] += 1;
  }

  return counts;
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const hasUvx = await hasCommand("uvx");
  const command = hasUvx ? "uvx" : "uv";
  const args = hasUvx
    ? [
        "--python",
        "3.11",
        "--from",
        "slither-analyzer",
        "slither",
        ".",
        "--config-file",
        "slither.config.json",
        "--json",
        "-"
      ]
    : [
        "tool",
        "run",
        "--python",
        "3.11",
        "--from",
        "slither-analyzer",
        "slither",
        ".",
        "--config-file",
        "slither.config.json",
        "--json",
        "-"
      ];

  const { code, stdout } = await run(command, args);
  await writeFile(outputPath, stdout, "utf8");

  let report;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    console.error(`Failed to parse Slither JSON output from ${outputPath}.`);
    throw error;
  }

  if (report.success !== true) {
    throw new Error(`Slither reported success=false. See ${outputPath}.`);
  }

  const detectors = report.results?.detectors ?? [];
  const counts = summarizeDetectors(detectors);

  console.log(`Slither report written to ${outputPath}`);
  console.log(`High: ${counts.High ?? 0}`);
  console.log(`Medium: ${counts.Medium ?? 0}`);
  console.log(`Low: ${counts.Low ?? 0}`);
  console.log(`Informational: ${counts.Informational ?? 0}`);
  if ((counts.Optimization ?? 0) > 0) {
    console.log(`Optimization: ${counts.Optimization}`);
  }

  if ((counts.High ?? 0) > 0 || (counts.Medium ?? 0) > 0) {
    process.exitCode = 1;
    return;
  }

  if (code !== 0 && code !== 255) {
    process.exitCode = code;
    return;
  }

  console.log("Slither gate passed: zero High and zero Medium findings.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
