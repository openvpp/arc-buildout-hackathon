import type { DeviceId, WalletId } from '@/types/branded';

/**
 * Centralized query-key factories.
 *
 * All TanStack Query keys are defined here so invalidation and prefetching
 * target consistent, typed keys instead of ad-hoc string arrays scattered
 * across features. Keys are namespaced per feature and per wallet/device, since
 * telemetry and verification are displayed separately for each.
 */
export const queryKeys = {
  wallets: {
    all: ['wallets'] as const,
    list: () => [...queryKeys.wallets.all, 'list'] as const,
    detail: (walletId: WalletId) =>
      [...queryKeys.wallets.all, 'detail', walletId] as const,
  },
  devices: {
    all: ['devices'] as const,
    listByWallet: (walletId: WalletId) =>
      [...queryKeys.devices.all, 'byWallet', walletId] as const,
    detail: (deviceId: DeviceId) =>
      [...queryKeys.devices.all, 'detail', deviceId] as const,
  },
  telemetry: {
    all: ['telemetry'] as const,
    /** The latest (and only sellable) telemetry record for a device. */
    latest: (walletId: WalletId, deviceId: DeviceId) =>
      [...queryKeys.telemetry.all, 'latest', walletId, deviceId] as const,
  },
  verification: {
    all: ['verification'] as const,
    forRecord: (recordId: string) =>
      [...queryKeys.verification.all, 'record', recordId] as const,
  },
} as const;
