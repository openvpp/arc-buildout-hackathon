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

/**
 * Token shown for a device. This app's mint column wins. An imported
 * vehicle keeps that column empty and stores the Arc token as
 * `legacyArcNftTokenId`; the Base `nftTokenId` from the old export is
 * never stored.
 */
export function displayNftTokenId(
  nftTokenId: string | null,
  metadata: unknown,
): string | null {
  if (nftTokenId !== null && nftTokenId.length > 0) {
    return nftTokenId;
  }
  return legacyTokenId(metadata);
}

function legacyMintStatus(metadata: unknown): string | null {
  return legacyField(metadata, 'legacyArcMintStatus');
}

function legacyTokenId(metadata: unknown): string | null {
  const legacy = legacyField(metadata, 'legacyArcNftTokenId');
  if (legacy === null || !/^\d+$/.test(legacy)) {
    return null;
  }
  return legacy;
}

function legacyField(metadata: unknown, key: string): string | null {
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    return null;
  }
  const legacy = (metadata as Record<string, unknown>)[key];
  if (typeof legacy !== 'string') {
    return null;
  }
  const trimmed = legacy.trim();
  return trimmed.length > 0 ? trimmed : null;
}
