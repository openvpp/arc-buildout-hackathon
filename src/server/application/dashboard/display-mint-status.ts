/**
 * Status shown on the public globe. Imported vehicles keep
 * `devices.mint_status` as `unminted` so this app's worker does not treat a
 * mainnet token as minted on the chain it is configured for. A completed
 * legacy Arc mint is still the status visitors should see.
 */
export function displayMintStatus(
  mintStatus: string,
  metadata: unknown,
): string {
  if (
    mintStatus === 'minted' ||
    mintStatus === 'pending' ||
    mintStatus === 'failed'
  ) {
    return mintStatus;
  }
  const legacy = legacyMintStatus(metadata);
  if (legacy === 'minted' || legacy === 'pending' || legacy === 'failed') {
    return legacy;
  }
  return mintStatus;
}

function legacyMintStatus(metadata: unknown): string | null {
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    return null;
  }
  const legacy = (metadata as Record<string, unknown>).legacyArcMintStatus;
  return typeof legacy === 'string' ? legacy : null;
}
