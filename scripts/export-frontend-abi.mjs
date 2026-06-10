import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const artifactCandidates = [
  resolve('artifacts/contracts/CrapsGameV3.sol/CrapsGameV3.json'),
  resolve('artifacts/contracts/CrapsGameV2.sol/CrapsGameV2.json'),
];
const artifactPath = artifactCandidates.find((candidate) => existsSync(candidate));

if (!artifactPath) {
  throw new Error('No CrapsGame V3/V2 artifact found. Run pnpm compile first.');
}

const outputPath = resolve('frontend/src/abi/CrapsGame.json');
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(artifact.abi, null, 2)}\n`);

console.log(`Wrote ABI from ${artifactPath} to ${outputPath}`);
