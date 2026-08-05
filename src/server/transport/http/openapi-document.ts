/**
 * OpenAPI 3.1 document for the EV telemetry nanopayment API.
 * Circle Gateway x402 uses PAYMENT-REQUIRED / payment-signature headers.
 */
export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'EV Telemetry Nanopayment API',
    version: '0.2.0-circle-gateway',
    description:
      'Agent telemetry purchase via Circle Gateway x402 on Arc testnet. paymentTransactionHash (settlement) and anchorTransactionHash remain distinct. Step-6 agent verification is independent evidence.',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local Next.js web/API process',
    },
  ],
  tags: [
    { name: 'Health' },
    { name: 'Agent' },
    { name: 'Webhooks' },
    { name: 'Dashboard' },
    { name: 'Verification' },
    { name: 'OpenAPI' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe',
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'Process is alive',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status', 'service', 'checkedAt'],
                  properties: {
                    status: { type: 'string', const: 'ok' },
                    service: { type: 'string' },
                    checkedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/readiness': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe',
        operationId: 'getReadiness',
        responses: {
          '200': {
            description: 'Critical dependencies are ready',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ReadinessResult' },
              },
            },
          },
          '503': {
            description: 'Service is not ready',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        },
      },
    },
    '/api/openapi': {
      get: {
        tags: ['OpenAPI'],
        summary: 'OpenAPI 3.1 document',
        operationId: 'getOpenApi',
        responses: {
          '200': {
            description: 'OpenAPI document',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
        },
      },
    },
    '/api/v1/agent/devices/latest': {
      get: {
        tags: ['Agent'],
        summary: 'Newest onboarded device for a wallet',
        operationId: 'getLatestAgentDevice',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'walletAddress',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { description: 'Latest device for wallet' },
          '404': { description: 'No device for wallet' },
        },
      },
    },
    '/api/v1/agent/telemetry/latest': {
      post: {
        tags: ['Agent'],
        summary: 'Request latest EV telemetry (Circle Gateway 402 flow)',
        operationId: 'requestLatestTelemetry',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'payment-signature',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Base64 Circle Gateway payment payload',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['walletAddress', 'deviceId'],
                properties: {
                  walletAddress: { type: 'string' },
                  deviceId: { type: 'string', format: 'uuid' },
                  lastKnownTelemetryRecordId: {
                    type: 'string',
                    format: 'uuid',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'NO_TELEMETRY_AVAILABLE | NO_NEW_RECORD | TELEMETRY_DELIVERED',
          },
          '402': {
            description:
              'PAYMENT_REQUIRED with PAYMENT-REQUIRED header (x402 v2)',
          },
        },
      },
    },
    '/api/webhooks/enode': {
      post: {
        tags: ['Webhooks'],
        summary: 'Receive Enode webhook',
        operationId: 'receiveEnodeWebhook',
        responses: {
          '202': { description: 'Accepted for async processing' },
          '200': { description: 'Duplicate delivery acknowledged' },
        },
      },
    },
    '/api/v1/wallets': {
      get: {
        tags: ['Dashboard'],
        summary: 'List wallets for principal',
        operationId: 'listWallets',
        security: [{ ApiKeyAuth: [] }],
        responses: { '200': { description: 'Wallet list' } },
      },
    },
    '/api/v1/wallets/{walletId}': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get wallet with devices',
        operationId: 'getWallet',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'walletId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Wallet detail' } },
      },
    },
    '/api/v1/devices/{deviceId}/telemetry': {
      get: {
        tags: ['Dashboard'],
        summary: 'Latest telemetry + verification for a device',
        operationId: 'getDeviceTelemetry',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'deviceId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Device telemetry snapshot' } },
      },
    },
    '/api/v1/vehicle-onboarding/link': {
      post: {
        tags: ['Dashboard'],
        summary: 'Start Enode vehicle Link session',
        operationId: 'createVehicleLink',
        responses: {
          '200': { description: 'linkUrl + pendingConnectionId' },
          '400': { description: 'Validation / provider unavailable' },
        },
      },
    },
    '/api/v1/vehicle-onboarding/oauth/enode-complete': {
      get: {
        tags: ['Dashboard'],
        summary: 'Complete Enode OAuth redirect',
        operationId: 'enodeOAuthComplete',
        responses: { '200': { description: 'Pending moved to pending_form' } },
      },
    },
    '/api/v1/verification/results': {
      post: {
        tags: ['Verification'],
        summary: 'Persist agent-side Arc + content-hash verification',
        operationId: 'submitVerificationResult',
        security: [{ ApiKeyAuth: [] }],
        responses: { '201': { description: 'Stored' } },
      },
    },
    '/api/v1/verification/{telemetryRecordId}': {
      get: {
        tags: ['Verification'],
        summary: 'Read agent verification status for a telemetry record',
        operationId: 'getVerificationResult',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'telemetryRecordId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Verification snapshot' } },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Api-Key',
      },
    },
    schemas: {
      ApiError: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'requestId'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              requestId: { type: 'string', format: 'uuid' },
              details: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
      ReadinessResult: {
        type: 'object',
        required: ['status', 'checkedAt', 'checks'],
        properties: {
          status: { type: 'string', enum: ['ready', 'not_ready'] },
          checkedAt: { type: 'string', format: 'date-time' },
          checks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'status'],
              properties: {
                name: { type: 'string' },
                status: { type: 'string', enum: ['pass', 'fail'] },
                detail: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const;

export type OpenApiDocument = typeof openApiDocument;
