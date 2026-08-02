import { toDeviceId, toWalletId } from '@/types/branded';
import type { Device } from '@/types/domain';

/**
 * PLACEHOLDER devices for shell/layout development only. Obviously-fake EXAMPLE
 * structures, NOT data from a live backend. Render behind a placeholder notice.
 */
export const PLACEHOLDER_DEVICES: readonly Device[] = [
  {
    id: toDeviceId('device_example_1'),
    walletId: toWalletId('wallet_example_alpha'),
    label: 'Example EV — Sedan',
    vendor: 'ExampleVendor',
    model: 'Model X (placeholder)',
  },
  {
    id: toDeviceId('device_example_2'),
    walletId: toWalletId('wallet_example_alpha'),
    label: 'Example EV — Van',
    vendor: 'ExampleVendor',
    model: 'Model V (placeholder)',
  },
  {
    id: toDeviceId('device_example_3'),
    walletId: toWalletId('wallet_example_beta'),
    label: 'Example EV — Hatch',
    vendor: 'ExampleVendor',
    model: 'Model H (placeholder)',
  },
] as const;
