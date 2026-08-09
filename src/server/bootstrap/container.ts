import { getServerEnv } from '@/server/config/env';
import type { CircleGatewaySeller } from '@/server/domain/payments/circle-gateway';
import type {
  DeviceRepository,
  OutboxRepository,
  PrincipalRepository,
  ProvenanceAnchor,
  TelemetryPricingPolicy,
  WalletRepository,
} from '@/server/domain/shared/ports';
import { createAuthService } from '@/server/infrastructure/auth/auth-service';
import type { AuthService } from '@/server/infrastructure/auth/auth-service';
import { createProvenanceAnchorForEnv } from '@/server/infrastructure/blockchain/provenance-anchor';
import {
  checkDatabaseConnectivity,
  getDb,
} from '@/server/infrastructure/db/client';
import type { Database } from '@/server/infrastructure/db/client';
import { createDeviceRepository } from '@/server/infrastructure/db/repositories/device-repository';
import { createOutboxRepository } from '@/server/infrastructure/db/repositories/outbox-repository';
import { createPrincipalRepository } from '@/server/infrastructure/db/repositories/principal-repository';
import { createWalletRepository } from '@/server/infrastructure/db/repositories/wallet-repository';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import type { ServerLogger } from '@/server/infrastructure/logging/logger';
import {
  createCircleGatewaySeller,
  createMockCircleGatewaySeller,
} from '@/server/infrastructure/payments/circle-gateway-seller';
import { createConfiguredPricingPolicy } from '@/server/infrastructure/payments/pricing-policy';

export type AppContainer = {
  readonly db: Database;
  readonly logger: ServerLogger;
  readonly auth: AuthService;
  readonly principals: PrincipalRepository;
  readonly wallets: WalletRepository;
  readonly devices: DeviceRepository;
  readonly outbox: OutboxRepository;
  readonly provenanceAnchor: ProvenanceAnchor;
  readonly pricing: TelemetryPricingPolicy;
  readonly circleSeller: CircleGatewaySeller;
  readonly checkDatabase: typeof checkDatabaseConnectivity;
};

let container: AppContainer | undefined;

function createCircleSellerForEnv(): CircleGatewaySeller {
  const env = getServerEnv();
  if (env.ALLOW_MOCK_ADAPTERS) {
    return createMockCircleGatewaySeller();
  }
  return createCircleGatewaySeller();
}

export function createContainer(): AppContainer {
  const db = getDb();
  return {
    db,
    logger: createServerLogger(),
    auth: createAuthService(db),
    principals: createPrincipalRepository(db),
    wallets: createWalletRepository(db),
    devices: createDeviceRepository(db),
    outbox: createOutboxRepository(db),
    provenanceAnchor: createProvenanceAnchorForEnv(),
    pricing: createConfiguredPricingPolicy(),
    circleSeller: createCircleSellerForEnv(),
    checkDatabase: checkDatabaseConnectivity,
  };
}

export function getContainer(): AppContainer {
  if (container === undefined) {
    container = createContainer();
  }
  return container;
}

export function resetContainer(): void {
  container = undefined;
}
