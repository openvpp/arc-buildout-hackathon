import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { openApiDocument } from '../src/server/transport/http/openapi-document';

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), 'openapi');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'openapi.json');
  await writeFile(
    outPath,
    `${JSON.stringify(openApiDocument, null, 2)}\n`,
    'utf8',
  );

  execFileSync('pnpm', ['exec', 'prettier', '--write', outPath], {
    stdio: 'inherit',
  });

  console.log(`Wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
