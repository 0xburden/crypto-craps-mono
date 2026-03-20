import fs from "node:fs";

const SOURCE_PATH = "contracts/CrapsGame.sol";
const COVERAGE_PATH = "coverage/coverage-final.json";
const THRESHOLD = 95;

const phase2FunctionNames = [
  "availableBalanceOf",
  "inPlayBalanceOf",
  "reservedBalanceOf",
  "deposit",
  "withdraw",
  "withdrawFees",
  "fundBankroll",
  "withdrawBankroll",
  "pause",
  "unpause",
  "getPlayerState",
  "_debitAvailable",
  "_creditAvailable",
  "_reserveFromBankroll",
  "_releaseReserve",
  "_trackPlayer",
  "_assertInvariant",
  "_assertInvariantIfNeeded"
];

const source = fs.readFileSync(SOURCE_PATH, "utf8");
const coverage = JSON.parse(fs.readFileSync(COVERAGE_PATH, "utf8"));
const fileCoverage = coverage[SOURCE_PATH];

if (!fileCoverage) {
  console.error(`No coverage data found for ${SOURCE_PATH}`);
  process.exit(1);
}

function lineNumberAt(index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function findFunctionSpan(name) {
  const signature = `function ${name}`;
  const startIndex = source.indexOf(signature);
  if (startIndex === -1) {
    throw new Error(`Could not find ${signature} in ${SOURCE_PATH}`);
  }

  const bodyStart = source.indexOf("{", startIndex);
  if (bodyStart === -1) {
    throw new Error(`Could not find body for ${signature} in ${SOURCE_PATH}`);
  }

  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          name,
          startLine: lineNumberAt(startIndex),
          endLine: lineNumberAt(i)
        };
      }
    }
  }

  throw new Error(`Could not determine end of ${signature} in ${SOURCE_PATH}`);
}

const spans = phase2FunctionNames.map(findFunctionSpan);

function isInPhase2Range(lineNumber) {
  return spans.some(({ startLine, endLine }) => lineNumber >= startLine && lineNumber <= endLine);
}

const executableLines = Object.entries(fileCoverage.l)
  .map(([line, hits]) => ({ line: Number(line), hits: Number(hits) }))
  .filter(({ line }) => isInPhase2Range(line));

const total = executableLines.length;
const covered = executableLines.filter(({ hits }) => hits > 0).length;
const percent = total === 0 ? 100 : (covered / total) * 100;

console.log(`Phase 2 vault line coverage (${SOURCE_PATH} selected functions): ${percent.toFixed(2)}% (${covered}/${total})`);

if (percent < THRESHOLD) {
  console.error(`Vault line coverage is below ${THRESHOLD}%`);
  process.exit(1);
}
