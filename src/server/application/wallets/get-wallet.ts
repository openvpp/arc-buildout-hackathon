import type { AuthenticatedPrincipal } from '@/server/infrastructure/auth/api-keys';
import type { Database } from '@/server/infrastructure/db/client';
import { createDeviceRepository } from '@/server/infrastructure/db/repositories/device-repository';
import { principalHasWalletAccess } from '@/server/infrastructure/db/repositories/telemetry-payment-repository';
import { createWalletRepository } from '@/server/infrastructure/db/repositories/wallet-repository';
import { ApiError } from '@/server/transport/http/api-error';

export type WalletDetail = {
  readonly id: string;
  readonly address: string;
  readonly label: string | null;
  readonly chainId: string;
  readonly status: string;
  readonly devices: ReadonlyArray<{
    readonly id: string;
    readonly displayName: string | null;
    readonly vendor: string | null;
    readonly model: string | null;
    readonly status: string;
    readonly externalDeviceId: string;
  }>;
};

export async function getWalletForPrincipal(input: {
  db: Database;
  principal: AuthenticatedPrincipal;
  walletId: string;
}): Promise<WalletDetail> {
  const allowed = await principalHasWalletAccess(
    input.db,
    input.principal.principalId,
    input.walletId,
  );
  if (!allowed) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Wallet not found.',
      status: 404,
    });
  }

  const wallets = createWalletRepository(input.db);
  const wallet = await wallets.findById(input.walletId);
  if (wallet === null) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Wallet not found.',
      status: 404,
    });
  }

  const devices = createDeviceRepository(input.db);
  const deviceRows = await devices.listByWallet(input.walletId);

  return {
    id: wallet.id,
    address: wallet.address,
    label: wallet.label,
    chainId: String(wallet.chainId),
    status: wallet.status,
    devices: deviceRows.map((device) => ({
      id: device.id,
      displayName: device.displayName,
      vendor: device.vendor,
      model: device.model,
      status: device.status,
      externalDeviceId: device.externalDeviceId,
    })),
  };
}
