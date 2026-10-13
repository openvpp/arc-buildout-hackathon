import { describe, expect, it } from 'vitest';

import {
  ENODE_VEHICLE_VENDORS,
  isEnodeVehicleVendor,
} from '@/lib/enode-vehicle-vendors';
import {
  buildEnodeLinkSessionBody,
  ENODE_LINK_LANGUAGE,
} from '@/server/infrastructure/enode/http-client';

describe('Enode vehicle vendors', () => {
  it('uses unique Enode vendor codes, not display names', () => {
    const codes = ENODE_VEHICLE_VENDORS.map((vendor) => vendor.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]+$/);
      expect(isEnodeVehicleVendor(code)).toBe(true);
    }
    expect(isEnodeVehicleVendor('TESLA')).toBe(true);
    expect(isEnodeVehicleVendor('ALFAROMEO')).toBe(true);
    expect(isEnodeVehicleVendor('LANDROVER')).toBe(true);
    expect(isEnodeVehicleVendor('CITROEN')).toBe(true);
    expect(isEnodeVehicleVendor('SKODA')).toBe(true);
    expect(isEnodeVehicleVendor('Tesla')).toBe(false);
    expect(isEnodeVehicleVendor('Alfa Romeo')).toBe(false);
    expect(isEnodeVehicleVendor('Škoda')).toBe(false);
    expect(isEnodeVehicleVendor('')).toBe(false);
  });
});

describe('buildEnodeLinkSessionBody', () => {
  it('always sends language and only includes a vendor when one is chosen', () => {
    expect(
      buildEnodeLinkSessionBody({
        vendorType: 'vehicle',
        scopes: ['vehicle:read:data'],
        redirectUri: 'https://example.test/callback',
        vendor: 'TESLA',
      }),
    ).toEqual({
      vendorType: 'vehicle',
      language: ENODE_LINK_LANGUAGE,
      scopes: ['vehicle:read:data'],
      redirectUri: 'https://example.test/callback',
      vendor: 'TESLA',
    });
    expect(ENODE_LINK_LANGUAGE).toBe('en-US');
    expect(
      buildEnodeLinkSessionBody({
        vendorType: 'vehicle',
        scopes: ['vehicle:read:data'],
        redirectUri: 'https://example.test/callback',
      }),
    ).not.toHaveProperty('vendor');
  });
});
