import { GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS } from '@circle-fin/x402-batching/server';

import {
  ARC_TESTNET_CAIP2,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_GATEWAY_WALLET,
  ARC_TESTNET_USDC_ADDRESS,
} from '@/server/config/circle';
import { getServerEnv, type ServerEnv } from '@/server/config/env';
import type { CircleGatewaySeller } from '@/server/domain/payments/circle-gateway';
import type { TelemetryPricingPolicy } from '@/server/domain/shared/ports';
import type { AuthenticatedPrincipal } from '@/server/infrastructure/auth/api-keys';
import type { Database } from '@/server/infrastructure/db/client';
import {
  creditAndDeliver,
  findActivePaymentRequirement,
  findDeliveryForPurchase,
  findDeviceById,
  findLatestTelemetryForDevice,
  findWalletByNormalizedAddress,
  getAgentCursor,
  insertPaymentRequirement,
  PaymentTransactionReuseError,
  principalHasWalletAccess,
  telemetryPayloadAsData,
} from '@/server/infrastructure/db/repositories/telemetry-payment-repository';
import { normalizeEvmAddress } from '@/server/infrastructure/db/repositories/wallet-repository';
import { ApiError } from '@/server/transport/http/api-error';

const MOCK_ONLY_SELLER_WALLET = '0x1111111111111111111111111111111111111111';

function resolveSellerWalletAddress(env: ServerEnv): string {
  if (
    env.SELLER_WALLET_ADDRESS !== undefined &&
    env.SELLER_WALLET_ADDRESS.length > 0
  ) {
    return env.SELLER_WALLET_ADDRESS;
  }
  if (env.ALLOW_MOCK_ADAPTERS) {
    return MOCK_ONLY_SELLER_WALLET;
  }
  throw new ApiError({
    code: 'INTERNAL_ERROR',
    message:
      'SELLER_WALLET_ADDRESS must be set when mock adapters are disabled.',
    status: 500,
    expose: false,
  });
}

export type LatestTelemetryResult =
  | {
      kind: 'NO_TELEMETRY_AVAILABLE';
      deviceId: string;
      checkedAt: string;
    }
  | {
      kind: 'NO_NEW_RECORD';
      deviceId: string;
      latestDeliveredTelemetryRecordId: string;
      checkedAt: string;
    }
  | {
      kind: 'PAYMENT_REQUIRED';
      paymentRequirement: {
        id: string;
        network: string;
        chainId: string;
        asset: string;
        tokenContractAddress: string;
        amountAtomic: string;
        amountDisplay: string;
        decimals: number;
        recipientAddress: string;
        payerAddress: string | null;
        expiresAt: string;
      };
      paymentRequiredHeader: string;
      telemetryReference: {
        deviceId: string;
        recordedAt: string;
      };
    }
  | {
      kind: 'TELEMETRY_DELIVERED';
      deliveryId: string;
      telemetry: {
        recordId: string;
        deviceId: string;
        schemaVersion: string;
        recordedAt: string;
        receivedAt: string;
        data: Record<string, unknown>;
      };
      payment: {
        paymentRequirementId: string;
        transactionHash: string;
        verifiedAt: string;
        chainId: string;
      };
      provenance: {
        status: 'PENDING' | 'ANCHORED';
        contentHash: string;
        hashAlgorithm: string;
        canonicalizationVersion: string;
        anchorTransactionHash: string | null;
        anchorBlockNumber: string | null;
        anchoredAt: string | null;
      };
    };

export async function requestLatestTelemetry(input: {
  db: Database;
  principal: AuthenticatedPrincipal;
  pricing: TelemetryPricingPolicy;
  circleSeller: CircleGatewaySeller;
  walletAddress: string;
  deviceId: string;
  paymentSignatureHeader: string | null;
  resourceUrl: string;
}): Promise<LatestTelemetryResult> {
  const env = getServerEnv();
  const chainId = BigInt(env.ARC_CHAIN_ID ?? Number(ARC_TESTNET_CHAIN_ID));
  const normalized = normalizeEvmAddress(input.walletAddress);

  const wallet = await findWalletByNormalizedAddress(
    input.db,
    chainId,
    normalized,
  );
  if (wallet === null) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Wallet or device not found.',
      status: 404,
    });
  }

  const allowed = await principalHasWalletAccess(
    input.db,
    input.principal.principalId,
    wallet.id,
  );
  if (!allowed) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Wallet or device not found.',
      status: 404,
    });
  }

  const device = await findDeviceById(input.db, input.deviceId);
  if (device === null || device.walletId !== wallet.id) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Wallet or device not found.',
      status: 404,
    });
  }

  const latest = await findLatestTelemetryForDevice(input.db, device.id);
  const checkedAt = new Date().toISOString();

  if (latest === null) {
    return {
      kind: 'NO_TELEMETRY_AVAILABLE',
      deviceId: device.id,
      checkedAt,
    };
  }

  const cursor = await getAgentCursor(
    input.db,
    input.principal.principalId,
    device.id,
  );
  if (cursor?.lastDeliveredRecordId === latest.id) {
    return {
      kind: 'NO_NEW_RECORD',
      deviceId: device.id,
      latestDeliveredTelemetryRecordId: latest.id,
      checkedAt,
    };
  }

  const existingDelivery = await findDeliveryForPurchase(
    input.db,
    input.principal.principalId,
    latest.id,
  );
  if (existingDelivery !== null) {
    return buildDeliveredResult({
      deliveryId: existingDelivery.id,
      record: latest,
      paymentRequirementId: existingDelivery.paymentRequirementId,
      transactionHash: '',
      verifiedAt: existingDelivery.deliveredAt.toISOString(),
      chainId: String(chainId),
    });
  }

  if (
    env.PROVENANCE_DELIVERY_MODE === 'strict' &&
    latest.anchorStatus !== 'anchored'
  ) {
    throw new ApiError({
      code: 'PROVENANCE_PENDING',
      message:
        'Telemetry is not yet provenance-anchored. Retry after the worker confirms the BatchAnchor.',
      status: 409,
      details: {
        telemetryRecordId: latest.id,
        anchorStatus: latest.anchorStatus,
        deliveryMode: env.PROVENANCE_DELIVERY_MODE,
      },
    });
  }

  const price = await input.pricing.getPrice({
    deviceId: device.id,
    telemetryRecordId: latest.id,
  });

  let requirement = await findActivePaymentRequirement(
    input.db,
    input.principal.principalId,
    latest.id,
    price.pricingVersion,
  );

  const seller = resolveSellerWalletAddress(env);
  const token = env.ARC_USDC_CONTRACT_ADDRESS ?? ARC_TESTNET_USDC_ADDRESS;
  const gatewayWallet =
    env.CIRCLE_GATEWAY_WALLET_ADDRESS ?? ARC_TESTNET_GATEWAY_WALLET;

  if (requirement === null) {
    const expiresAt = new Date(
      Date.now() + env.PAYMENT_REQUIREMENT_TTL_SECONDS * 1000,
    );
    requirement = await insertPaymentRequirement(input.db, {
      principalId: input.principal.principalId,
      walletId: wallet.id,
      deviceId: device.id,
      telemetryRecordId: latest.id,
      pricingVersion: price.pricingVersion,
      network: 'arc-testnet',
      chainId,
      asset: price.asset,
      tokenContractAddress: token,
      amountAtomic: price.amountAtomic,
      amountDisplay: price.amountDisplay,
      decimals: price.decimals,
      sellerWalletAddress: seller,
      payerWalletAddress: wallet.address,
      status: 'pending',
      expiresAt,
    });
  }

  if (
    input.paymentSignatureHeader === null ||
    input.paymentSignatureHeader.length === 0
  ) {
    const paymentRequired = input.circleSeller.buildPaymentRequired({
      resourceUrl: input.resourceUrl,
      description: 'Latest EV telemetry record',
      amountAtomic: requirement.amountAtomic,
      payTo: requirement.sellerWalletAddress,
      asset: requirement.tokenContractAddress,
      network: ARC_TESTNET_CAIP2,
      verifyingContract: gatewayWallet,
      maxTimeoutSeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
    });

    return {
      kind: 'PAYMENT_REQUIRED',
      paymentRequirement: {
        id: requirement.id,
        network: requirement.network,
        chainId: String(requirement.chainId),
        asset: requirement.asset,
        tokenContractAddress: requirement.tokenContractAddress,
        amountAtomic: requirement.amountAtomic,
        amountDisplay: requirement.amountDisplay,
        decimals: requirement.decimals,
        recipientAddress: requirement.sellerWalletAddress,
        payerAddress: requirement.payerWalletAddress,
        expiresAt: requirement.expiresAt.toISOString(),
      },
      paymentRequiredHeader:
        input.circleSeller.encodePaymentRequiredHeader(paymentRequired),
      telemetryReference: {
        deviceId: device.id,
        recordedAt: latest.recordedAt.toISOString(),
      },
    };
  }

  const settleBody = input.circleSeller.buildPaymentRequired({
    resourceUrl: input.resourceUrl,
    description: 'Latest EV telemetry record',
    amountAtomic: requirement.amountAtomic,
    payTo: requirement.sellerWalletAddress,
    asset: requirement.tokenContractAddress,
    network: ARC_TESTNET_CAIP2,
    verifyingContract: gatewayWallet,
    maxTimeoutSeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
  });
  const settleRequirements = settleBody.accepts[0];

  if (settleRequirements === undefined) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: 'Payment requirements could not be constructed.',
      status: 500,
      expose: false,
    });
  }

  const settled = await input.circleSeller.settle({
    paymentSignatureHeader: input.paymentSignatureHeader,
    requirements: settleRequirements,
  });

  if (!settled.success) {
    throw new ApiError({
      code:
        settled.code === 'PAYMENT_VERIFICATION_UNAVAILABLE'
          ? 'PAYMENT_VERIFICATION_UNAVAILABLE'
          : 'PAYMENT_TRANSACTION_INVALID',
      message: settled.message,
      status: 402,
    });
  }

  try {
    const credited = await creditAndDeliver({
      db: input.db,
      principalId: input.principal.principalId,
      walletId: wallet.id,
      deviceId: device.id,
      telemetryRecordId: latest.id,
      paymentRequirementId: requirement.id,
      chainId,
      amountAtomic: requirement.amountAtomic,
      asset: requirement.asset,
      transactionHash: settled.transactionHash,
      payerAddress: settled.payer,
      tokenContractAddress: requirement.tokenContractAddress,
    });

    return buildDeliveredResult({
      deliveryId: credited.deliveryId,
      record: latest,
      paymentRequirementId: requirement.id,
      transactionHash: settled.transactionHash,
      verifiedAt: new Date().toISOString(),
      chainId: String(chainId),
    });
  } catch (error) {
    if (error instanceof PaymentTransactionReuseError) {
      throw new ApiError({
        code: 'PAYMENT_TRANSACTION_REUSED',
        message: 'Settlement transaction is already linked to another payment.',
        status: 409,
        details: { transactionHash: error.transactionHash },
      });
    }
    throw error;
  }
}

function buildDeliveredResult(input: {
  deliveryId: string;
  record: {
    id: string;
    deviceId: string;
    schemaVersion: string;
    recordedAt: Date;
    receivedAt: Date;
    telemetryPayload: Record<string, unknown>;
    contentHash: string;
    contentHashAlgorithm: string;
    canonicalizationVersion: string;
    anchorStatus: string;
    anchorTransactionHash: string | null;
    anchorBlockNumber: bigint | null;
    anchoredAt: Date | null;
  };
  paymentRequirementId: string;
  transactionHash: string;
  verifiedAt: string;
  chainId: string;
}): LatestTelemetryResult {
  const data = telemetryPayloadAsData(input.record.telemetryPayload);
  return {
    kind: 'TELEMETRY_DELIVERED',
    deliveryId: input.deliveryId,
    telemetry: {
      recordId: input.record.id,
      deviceId: input.record.deviceId,
      schemaVersion: input.record.schemaVersion,
      recordedAt: input.record.recordedAt.toISOString(),
      receivedAt: input.record.receivedAt.toISOString(),
      data: { ...data },
    },
    payment: {
      paymentRequirementId: input.paymentRequirementId,
      transactionHash: input.transactionHash,
      verifiedAt: input.verifiedAt,
      chainId: input.chainId,
    },
    provenance: {
      status: input.record.anchorStatus === 'anchored' ? 'ANCHORED' : 'PENDING',
      contentHash: input.record.contentHash,
      hashAlgorithm: input.record.contentHashAlgorithm,
      canonicalizationVersion: input.record.canonicalizationVersion,
      anchorTransactionHash: input.record.anchorTransactionHash,
      anchorBlockNumber:
        input.record.anchorBlockNumber !== null
          ? String(input.record.anchorBlockNumber)
          : null,
      anchoredAt: input.record.anchoredAt?.toISOString() ?? null,
    },
  };
}
