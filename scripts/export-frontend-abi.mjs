import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const artifactPath = resolve('artifacts/contracts/CrapsGameV2.sol/CrapsGameV2.json');
const outputPath = resolve('frontend/src/abi/CrapsGame.json');
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(artifact.abi, null, 2)}\n`);

console.log(`Wrote ABI to ${outputPath}`);
