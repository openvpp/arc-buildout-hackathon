import { describe, expect, it } from 'vitest';

import { buildSimpleDeviceMetadataUri } from '@/server/infrastructure/blockchain/device-nft';

describe('buildSimpleDeviceMetadataUri', () => {
  it('publishes only our device id', () => {
    const deviceId = '11111111-2222-3333-4444-555555555555';
    const uri = buildSimpleDeviceMetadataUri(deviceId);
    const encoded = uri.slice('data:application/json;base64,'.length);
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64').toString('utf8'),
    ) as Record<string, unknown>;

    expect(payload).toEqual({ vehicleId: deviceId });
    expect(Object.keys(payload)).toEqual(['vehicleId']);
  });
});
