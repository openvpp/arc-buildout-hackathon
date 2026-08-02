import { describe, expect, it } from 'vitest';

import { GET as getHealth } from '@/app/api/health/route';

describe('GET /api/health', () => {
  it('returns liveness without depending on PostgreSQL', async () => {
    const response = await getHealth(
      new Request('http://localhost:3000/api/health'),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      service: string;
    };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('ev-telemetry-backend');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
