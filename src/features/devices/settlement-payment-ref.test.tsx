import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SettlementPaymentRef } from './settlement-payment-ref';

describe('SettlementPaymentRef', () => {
  it('links on-chain transaction hashes to Arcscan', () => {
    const hash =
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    render(<SettlementPaymentRef settlementRef={hash} />);

    expect(
      screen.getByRole('link', { name: /View settlement transaction/i }),
    ).toHaveAttribute('href', `https://explorer.test.example/tx/${hash}`);
    expect(
      screen.queryByText(/Pending on-chain settlement/i),
    ).not.toBeInTheDocument();
  });

  it('shows pending state for Circle transfer UUIDs without an explorer link', () => {
    const transferId = 'b887267c-04ff-4bc9-8c1e-6d0c053119b2';
    render(<SettlementPaymentRef settlementRef={transferId} />);

    expect(
      screen.getByText(/Pending on-chain settlement/i),
    ).toBeInTheDocument();
    expect(screen.getByText(transferId)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /View settlement transaction/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Circle transfer id/i)).toBeInTheDocument();
  });
});
