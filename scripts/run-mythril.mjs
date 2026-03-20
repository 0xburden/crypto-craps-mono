import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import path, { delimiter } from "node:path";

const configPath = "mythril.config.json";

async function hasCommand(command) {
  const paths = (process.env.PATH ?? "").split(delimiter);
  for (const entry of paths) {
    if (!entry) continue;
    try {
      await access(path.join(entry, command), fsConstants.X_OK);
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

function parseRunnerPreference(value) {
  if (!value || value === "auto") return "auto";
  if (value === "local" || value === "docker") return value;
  throw new Error(`Unsupported Mythril runner: ${value}`);
}

async function main() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const outputPath = process.env.MYTHRIL_REPORT_PATH ?? config.reportPath ?? "audit/reports/mythril-report.json";
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  const target = process.env.MYTHRIL_TARGET ?? config.targets?.[0];
  if (!target) {
    throw new Error("No Mythril target configured.");
  }

  const timeout = String(config["execution-timeout"] ?? 120);
  const solv = String(config.solv ?? "0.8.24");
  const solcJson = process.env.MYTHRIL_SOLC_JSON ?? config.solcJson ?? "audit/mythril-solc-settings.json";
  const dockerImage = process.env.MYTHRIL_DOCKER_IMAGE ?? config.dockerImage ?? "mythril/myth";
  const localCommand = (await hasCommand("myth")) ? "myth" : ((await hasCommand("mythril")) ? "mythril" : null);
  const requestedRunner = parseRunnerPreference(process.env.MYTHRIL_RUNNER ?? config.runner);

  let runner = requestedRunner;
  if (runner === "auto") {
    if (localCommand) {
      runner = "local";
    } else if (process.env.CI || process.arch !== "arm64") {
      runner = "docker";
    } else {
      throw new Error(
        "No local Mythril binary found. On arm64 hosts, install Mythril locally (preferred) or set MYTHRIL_RUNNER=docker if Docker works in your environment."
      );
    }
  }

  if (runner === "local" && !localCommand) {
    throw new Error("MYTHRIL_RUNNER=local was requested but neither 'myth' nor 'mythril' is installed.");
  }

  const localSolcArgs = `--base-path . --include-path node_modules --allow-paths .,${path.join(process.cwd(), "node_modules")}`;
  const dockerSolcArgs = "--base-path /src --include-path /src/node_modules --allow-paths /src,/src/node_modules";

  const mythrilArgs = [
    "analyze",
    target,
    "--execution-timeout",
    timeout,
    "--solv",
    solv,
    "--solc-json",
    runner === "docker" ? `/src/${solcJson}` : solcJson,
    "--solc-args",
    runner === "docker" ? dockerSolcArgs : localSolcArgs,
    "-o",
    "jsonv2"
  ];

  const command = runner === "docker" ? "docker" : localCommand;
  const args = runner === "docker"
    ? ["run", "--rm", "-v", `${process.cwd()}:/src`, "-w", "/src", dockerImage, ...mythrilArgs]
    : mythrilArgs;

  console.error(`Running Mythril via ${runner}...`);
  const { code, stdout } = await run(command, args);
  await writeFile(outputPath, stdout, "utf8");

  let report;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    console.error(`Failed to parse Mythril JSON output from ${outputPath}.`);
    throw error;
  }

  const issues = Array.isArray(report.issues) ? report.issues : [];
  console.log(`Mythril report written to ${outputPath}`);
  console.log(`Mythril issues detected: ${issues.length}`);

  if (issues.length > 0) {
    process.exitCode = 1;
    return;
  }

  if (code !== 0) {
    process.exitCode = code;
    return;
  }

  console.log("Mythril gate passed: zero vulnerabilities detected.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
