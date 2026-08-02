import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openApiDocument } from '../src/server/transport/http/openapi-document';

async function main(): Promise<void> {
  const onDiskPath = path.join(process.cwd(), 'openapi', 'openapi.json');
  const onDisk = await readFile(onDiskPath, 'utf8');

  const tempDir = mkdtempSync(path.join(tmpdir(), 'openapi-check-'));
  const tempPath = path.join(tempDir, 'openapi.json');
  writeFileSync(
    tempPath,
    `${JSON.stringify(openApiDocument, null, 2)}\n`,
    'utf8',
  );
  execFileSync('pnpm', ['exec', 'prettier', '--write', tempPath], {
    stdio: 'pipe',
  });
  const expected = await readFile(tempPath, 'utf8');
  rmSync(tempDir, { recursive: true, force: true });

  if (onDisk !== expected) {
    console.error(
      'OpenAPI drift detected. Run `pnpm openapi:generate` and commit openapi/openapi.json.',
    );
    process.exit(1);
  }

  console.log('OpenAPI document is up to date.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
