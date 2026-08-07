import { createHash } from 'node:crypto';

import { createPublicClient, http } from 'viem';

import {
  API_KEY_HEADER,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from '@/server/config/constants';
import { getServerEnv } from '@/server/config/env';
import { formatAtomicAmount } from '@/server/domain/shared/money';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import {
  createCircleGatewayBuyer,
  createMockCircleGatewayBuyer,
} from '@/server/infrastructure/payments/circle-gateway-buyer';
import {
  findGatewayBatchingOption,
  parsePaymentRequiredHeader,
} from '@/server/infrastructure/payments/circle-gateway-seller';
import {
  isCircleTransferUuid,
  isOnchainTxHash,
  resolveCircleX402TransferTxHash,
} from '@/server/infrastructure/payments/circle-x402-transfer';

const log = createServerLogger({ component: 'demo-agent' });

type DeliveredResponse = {
  status: 'TELEMETRY_DELIVERED';
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
    status: string;
    contentHash: string;
    hashAlgorithm: string;
    canonicalizationVersion: string;
  };
};

type LatestDeviceResponse = {
  device: {
    deviceId: string;
    externalDeviceId: string;
    displayName: string | null;
  };
};

async function resolveDeviceId(input: {
  apiBaseUrl: string;
  apiKey: string;
  walletAddress: string;
  overrideDeviceId: string | undefined;
}): Promise<string | null> {
  if (
    input.overrideDeviceId !== undefined &&
    input.overrideDeviceId.length > 0
  ) {
    return input.overrideDeviceId;
  }

  const url = new URL(`${input.apiBaseUrl}/api/v1/agent/devices/latest`);
  url.searchParams.set('walletAddress', input.walletAddress);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      [API_KEY_HEADER]: input.apiKey,
    },
  });

  if (response.status === 404) {
    log.info('agent.no_device');
    return null;
  }
  if (!response.ok) {
    log.warn('agent.device_lookup_failed', { status: response.status });
    return null;
  }

  const body = (await response.json()) as LatestDeviceResponse;
  log.info('agent.device_resolved', {
    deviceId: body.device.deviceId,
    externalDeviceId: body.device.externalDeviceId,
    displayName: body.device.displayName,
  });
  return body.device.deviceId;
}

async function pollOnce(input: {
  apiBaseUrl: string;
  apiKey: string;
  walletAddress: string;
  deviceId: string;
}): Promise<void> {
  const env = getServerEnv();
  const url = `${input.apiBaseUrl}/api/v1/agent/telemetry/latest`;

  const first = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [API_KEY_HEADER]: input.apiKey,
    },
    body: JSON.stringify({
      walletAddress: input.walletAddress,
      deviceId: input.deviceId,
    }),
  });

  if (first.status === 200) {
    const body = (await first.json()) as { status: string };
    log.info('agent.poll_result', {
      status: body.status,
      deviceId: input.deviceId,
    });
    return;
  }

  if (first.status !== 402) {
    log.warn('agent.unexpected_status', { status: first.status });
    return;
  }

  const paymentRequiredHeader = first.headers.get(PAYMENT_REQUIRED_HEADER);
  if (paymentRequiredHeader === null) {
    log.error('agent.missing_payment_required_header');
    return;
  }

  const paymentRequired = parsePaymentRequiredHeader(paymentRequiredHeader);
  const batching = findGatewayBatchingOption(paymentRequired);
  if (batching === null) {
    log.error('agent.no_gateway_option');
    return;
  }

  const buyer = env.ALLOW_MOCK_ADAPTERS
    ? createMockCircleGatewayBuyer()
    : createCircleGatewayBuyer();
  const amountUsdc = Number(formatAtomicAmount(batching.amount, 6));
  await buyer.ensureLiquidity(amountUsdc);
  const signature = await buyer.createPaymentSignature({
    x402Version: paymentRequired.x402Version,
    requirements: batching,
    resource: paymentRequired.resource,
  });

  const second = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [API_KEY_HEADER]: input.apiKey,
      [PAYMENT_SIGNATURE_HEADER]: signature,
    },
    body: JSON.stringify({
      walletAddress: input.walletAddress,
      deviceId: input.deviceId,
    }),
  });

  if (second.status !== 200) {
    log.warn('agent.settle_failed', { status: second.status });
    return;
  }

  const body: unknown = await second.json();
  if (!isDeliveredResponse(body)) {
    let status = 'unknown';
    if (typeof body === 'object' && body !== null && 'status' in body) {
      const rawStatus = Reflect.get(body, 'status');
      if (typeof rawStatus === 'string') {
        status = rawStatus;
      }
    }
    log.info('agent.poll_result', { status });
    return;
  }

  await verifyAndReport({
    apiBaseUrl: input.apiBaseUrl,
    apiKey: input.apiKey,
    delivered: body,
    rpcUrl: env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network',
  });
}

function isDeliveredResponse(body: unknown): body is DeliveredResponse {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  return (
    Reflect.get(body, 'status') === 'TELEMETRY_DELIVERED' &&
    'telemetry' in body &&
    'payment' in body &&
    'provenance' in body
  );
}

async function verifyAndReport(input: {
  apiBaseUrl: string;
  apiKey: string;
  delivered: DeliveredResponse;
  rpcUrl: string;
}): Promise<void> {
  const client = createPublicClient({
    transport: http(input.rpcUrl),
  });

  let receiptFound = false;
  let receiptSuccess = false;
  const settlementRef = input.delivered.payment.transactionHash;
  let onchainTx: string | null = isOnchainTxHash(settlementRef)
    ? settlementRef.toLowerCase()
    : null;

  if (onchainTx === null && isCircleTransferUuid(settlementRef)) {
    onchainTx = await resolveCircleX402TransferTxHash(settlementRef);
  }

  if (onchainTx !== null) {
    try {
      const receipt = await client.getTransactionReceipt({
        hash: onchainTx as `0x${string}`,
      });
      receiptFound = true;
      receiptSuccess = receipt.status === 'success';
    } catch {
      receiptFound = false;
      receiptSuccess = false;
    }
  }

  const contentHashComputed = createHash('sha256')
    .update(JSON.stringify(input.delivered.telemetry.data), 'utf8')
    .digest('hex');
  const contentHashMatched =
    contentHashComputed === input.delivered.provenance.contentHash;

  let status:
    | 'VERIFIED'
    | 'TX_MISSING'
    | 'TX_FAILED'
    | 'HASH_MISMATCH'
    | 'PENDING_ONCHAIN' = 'VERIFIED';
  if (onchainTx === null) {
    status = contentHashMatched ? 'PENDING_ONCHAIN' : 'HASH_MISMATCH';
  } else if (!receiptFound) status = 'TX_MISSING';
  else if (!receiptSuccess) status = 'TX_FAILED';
  else if (!contentHashMatched) status = 'HASH_MISMATCH';
  else status = 'VERIFIED';

  await fetch(`${input.apiBaseUrl}/api/v1/verification/results`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [API_KEY_HEADER]: input.apiKey,
    },
    body: JSON.stringify({
      telemetryRecordId: input.delivered.telemetry.recordId,
      paymentTransactionHash: input.delivered.payment.transactionHash,
      status,
      receiptFound,
      receiptSuccess,
      contentHashExpected: input.delivered.provenance.contentHash,
      contentHashComputed,
      contentHashMatched,
      details:
        onchainTx !== null && onchainTx !== settlementRef.toLowerCase()
          ? { resolvedTransactionHash: onchainTx }
          : undefined,
    }),
  });

  log.info('agent.verification_reported', {
    status,
    receiptFound,
    resolved: onchainTx !== null,
  });
}

async function main(): Promise<void> {
  const env = getServerEnv();
  const apiBaseUrl =
    env.AGENT_API_BASE_URL !== undefined && env.AGENT_API_BASE_URL.length > 0
      ? env.AGENT_API_BASE_URL
      : 'http://localhost:3000';
  const apiKey = process.env.AGENT_API_KEY;
  const walletAddress = process.env.AGENT_WALLET_ADDRESS;
  const overrideDeviceId = process.env.AGENT_DEVICE_ID;

  if (apiKey === undefined || walletAddress === undefined) {
    throw new Error('AGENT_API_KEY and AGENT_WALLET_ADDRESS are required');
  }

  log.info('agent.starting', {
    pollIntervalSeconds: env.AGENT_POLL_INTERVAL_SECONDS,
    deviceOverride:
      overrideDeviceId !== undefined && overrideDeviceId.length > 0,
  });

  const tick = async () => {
    try {
      const deviceId = await resolveDeviceId({
        apiBaseUrl,
        apiKey,
        walletAddress,
        overrideDeviceId,
      });
      if (deviceId === null) {
        return;
      }
      await pollOnce({ apiBaseUrl, apiKey, walletAddress, deviceId });
    } catch (error) {
      log.error('agent.tick_failed', {
        errorMessage: error instanceof Error ? error.message : 'unknown',
      });
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, env.AGENT_POLL_INTERVAL_SECONDS * 1000);
}

main().catch((error: unknown) => {
  log.error('agent.crashed', {
    errorMessage: error instanceof Error ? error.message : 'unknown',
  });
  process.exit(1);
});
