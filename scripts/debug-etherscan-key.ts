import "dotenv/config";

function mask(value: string): string {
  if (value.length <= 8) {
    return `${value[0] ?? ""}***${value[value.length - 1] ?? ""}`;
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function main() {
  const raw = process.env.BASESCAN_API_KEY;

  if (raw === undefined) {
    console.log("BASESCAN_API_KEY is undefined");
    return;
  }

  const trimmed = raw.trim();
  const startsWithQuote = raw.startsWith('"') || raw.startsWith("'");
  const endsWithQuote = raw.endsWith('"') || raw.endsWith("'");
  const hasLeadingWhitespace = raw.length > 0 && raw[0] !== raw.trimStart()[0];
  const hasTrailingWhitespace = raw.length > 0 && raw[raw.length - 1] !== raw.trimEnd()[raw.trimEnd().length - 1];

  console.log("BASESCAN_API_KEY debug");
  console.log(`- raw length: ${raw.length}`);
  console.log(`- trimmed length: ${trimmed.length}`);
  console.log(`- masked raw: ${mask(raw)}`);
  console.log(`- masked trimmed: ${mask(trimmed)}`);
  console.log(`- starts with quote: ${startsWithQuote ? "yes" : "no"}`);
  console.log(`- ends with quote: ${endsWithQuote ? "yes" : "no"}`);
  console.log(`- has leading whitespace: ${hasLeadingWhitespace ? "yes" : "no"}`);
  console.log(`- has trailing whitespace: ${hasTrailingWhitespace ? "yes" : "no"}`);
  console.log(`- equals trimmed: ${raw === trimmed ? "yes" : "no"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
