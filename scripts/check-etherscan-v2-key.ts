import "dotenv/config";

type Probe = {
  name: string;
  chainId: string;
  address: string;
  expectContractName?: string;
};

type ApiResponse = {
  status?: string;
  message?: string;
  result?: unknown;
};

const probes: Probe[] = [
  {
    name: "Ethereum Mainnet LINK token",
    chainId: "1",
    address: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    expectContractName: "ChainLink Token"
  },
  {
    name: "Base Sepolia LINK token",
    chainId: "84532",
    address: "0xE4aB69C077896252FAFBD49EFD26B5D171A32410"
  }
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function summarizeResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  if (Array.isArray(result) && result.length > 0 && isObject(result[0])) {
    const first = result[0] as Record<string, unknown>;
    const contractName = typeof first.ContractName === "string" ? first.ContractName : "unknown";
    const compilerVersion = typeof first.CompilerVersion === "string" ? first.CompilerVersion : "unknown";
    return `ContractName=${contractName}, CompilerVersion=${compilerVersion}`;
  }

  return JSON.stringify(result);
}

async function fetchJson(url: URL): Promise<ApiResponse> {
  const response = await fetch(url);
  const text = await response.text();

  try {
    return JSON.parse(text) as ApiResponse;
  } catch {
    throw new Error(`Non-JSON response from ${url.origin}: ${text.slice(0, 200)}`);
  }
}

async function checkV2Key(apiKey: string) {
  console.log("Testing Etherscan V2 key compatibility...\n");

  let passed = 0;
  let failed = 0;

  for (const probe of probes) {
    const url = new URL("https://api.etherscan.io/v2/api");
    url.searchParams.set("chainid", probe.chainId);
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "getsourcecode");
    url.searchParams.set("address", probe.address);
    url.searchParams.set("apikey", apiKey);

    process.stdout.write(`- ${probe.name}: `);

    try {
      const json = await fetchJson(url);
      const resultSummary = summarizeResult(json.result);
      const ok = json.status === "1";
      const invalid = `${json.message ?? ""} ${typeof json.result === "string" ? json.result : ""}`.toLowerCase().includes("invalid api key");

      if (ok) {
        if (
          probe.expectContractName !== undefined &&
          (!Array.isArray(json.result) || !isObject(json.result[0]) || json.result[0].ContractName !== probe.expectContractName)
        ) {
          console.log(`unexpected success payload (${resultSummary})`);
          failed += 1;
          continue;
        }

        console.log(`PASS (${resultSummary})`);
        passed += 1;
        continue;
      }

      if (invalid) {
        console.log(`FAIL (invalid key: ${resultSummary})`);
      } else {
        console.log(`FAIL (${json.message ?? "unknown message"}: ${resultSummary})`);
      }
      failed += 1;
    } catch (error) {
      console.log(`ERROR (${error instanceof Error ? error.message : String(error)})`);
      failed += 1;
    }
  }

  const legacyUrl = new URL("https://api-sepolia.basescan.org/api");
  legacyUrl.searchParams.set("module", "contract");
  legacyUrl.searchParams.set("action", "getsourcecode");
  legacyUrl.searchParams.set("address", probes[1].address);
  legacyUrl.searchParams.set("apikey", apiKey);

  console.log("\nLegacy BaseScan V1 endpoint sanity check:");
  try {
    const json = await fetchJson(legacyUrl);
    console.log(`- Response: ${json.message ?? "unknown message"} | ${summarizeResult(json.result)}`);
  } catch (error) {
    console.log(`- ERROR (${error instanceof Error ? error.message : String(error)})`);
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  const apiKey = process.env.BASESCAN_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("BASESCAN_API_KEY is missing");
  }

  await checkV2Key(apiKey);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
