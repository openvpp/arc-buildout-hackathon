import { z } from 'zod';

import { bindDashboardOwnerWallet } from '@/server/application/onboarding/bind-dashboard-owner';
import { finalizePendingVehicleConnection } from '@/server/application/onboarding/finalize-pending';
import { getContainer } from '@/server/bootstrap/container';
import { verifyWeb3AuthIdentity } from '@/server/infrastructure/auth/web3auth-identity';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const completeBodySchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, 'must be an EVM address'),
    formData: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** POST /api/v1/vehicle-onboarding/pending/:id/complete */
export const POST = createRouteHandler(async (request, requestContext) => {
  const parts = new URL(request.url).pathname.split('/');
  const id = parts.at(-2);
  if (id === undefined || id.length === 0) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'pending id required',
      status: 400,
    });
  }

  const parsed = completeBodySchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Invalid complete payload.',
      status: 400,
      details: { issues: parsed.error.issues },
    });
  }

  const identity = await verifyWeb3AuthIdentity({
    authorizationHeader: request.headers.get('authorization'),
    claimedWalletAddress: parsed.data.walletAddress,
  });

  const container = getContainer();
  await bindDashboardOwnerWallet(container.db, identity);

  try {
    const result = await finalizePendingVehicleConnection(container.db, {
      pendingConnectionId: id,
      walletAddress: identity.walletAddress,
      ...(parsed.data.formData !== undefined
        ? { formData: parsed.data.formData }
        : {}),
    });

    return jsonOk(
      {
        success: true,
        wasExistingDevice: result.wasExistingDevice,
        // Minting is asynchronous: 'pending' means a MINT_DEVICE_NFT worker job
        // was enqueued — poll the device read API until nftTokenId is populated.
        nftMintStatus: result.mintStatus,
        device: {
          id: result.device.id,
          walletId: result.device.walletId,
          externalDeviceId: result.device.externalDeviceId,
          displayName: result.device.displayName,
          vendor: result.device.vendor,
          model: result.device.model,
          status: result.device.status,
          mintStatus: result.device.mintStatus,
          nftTokenId: result.device.nftTokenId,
          nftContractAddress: result.device.nftContractAddress,
          nftTransactionHash: result.device.nftTransactionHash,
          network: result.device.network,
        },
      },
      requestContext.requestId,
    );
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const status =
      err.code === 'PENDING_CONNECTION_NOT_FOUND'
        ? 404
        : err.code === 'USER_ID_MISMATCH'
          ? 403
          : err.code === 'PENDING_CONNECTION_COMPLETED'
            ? 409
            : 400;
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: err.message ?? 'Failed to complete onboarding',
      status,
      details: { code: err.code },
    });
  }
});
