export const adminOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "AppBase Optional Administration",
    version: "0.4.0",
    license: {
      name: "Apache-2.0",
      identifier: "Apache-2.0",
    },
  },
  servers: [
    {
      url: "https://api.example/admin/api",
    },
    {
      url: "https://api.example/sandbox/admin/api",
    },
  ],
  paths: {
    "/context": {
      get: {
        operationId: "getAdminContext",
        summary: "getAdminContext",
        security: [
          {
            bearer: [],
          },
          {
            session: [],
          },
        ],
        "x-required-capabilities": ["admin:read"],
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Context",
                },
              },
            },
          },
          "401": {
            description: "Session expired or unauthenticated",
          },
          "403": {
            description: "Insufficient management permission or invalid Origin",
          },
          "404": {
            description: "User or grant not found",
          },
          "409": {
            description: "Environment, preview or grant state conflict",
          },
          "422": {
            description: "Invalid input",
          },
          "500": {
            description: "Operation failed; inspect state before retrying",
          },
        },
      },
    },
    "/users": {
      get: {
        operationId: "findAdminUser",
        summary: "findAdminUser",
        security: [
          {
            bearer: [],
          },
          {
            session: [],
          },
        ],
        "x-required-capabilities": ["admin:read"],
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/User",
                },
              },
            },
          },
          "401": {
            description: "Session expired or unauthenticated",
          },
          "403": {
            description: "Insufficient management permission or invalid Origin",
          },
          "404": {
            description: "User or grant not found",
          },
          "409": {
            description: "Environment, preview or grant state conflict",
          },
          "422": {
            description: "Invalid input",
          },
          "500": {
            description: "Operation failed; inspect state before retrying",
          },
        },
        parameters: [
          {
            name: "query",
            in: "query",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
      },
    },
    "/catalog": {
      get: {
        operationId: "getAdminCatalog",
        summary: "getAdminCatalog",
        security: [
          {
            bearer: [],
          },
          {
            session: [],
          },
        ],
        "x-required-capabilities": ["admin:read"],
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  anyOf: [
                    {
                      $ref: "#/components/schemas/Catalog",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
              },
            },
            headers: {
              ETag: {
                description: "Quoted catalog revision",
                schema: {
                  type: "string",
                },
              },
            },
          },
          "401": {
            description: "Session expired or unauthenticated",
          },
          "403": {
            description: "Insufficient management permission or invalid Origin",
          },
          "404": {
            description: "User or grant not found",
          },
          "409": {
            description: "Environment, preview or grant state conflict",
          },
          "422": {
            description: "Invalid input",
          },
          "500": {
            description: "Operation failed; inspect state before retrying",
          },
        },
      },
      put: {
        operationId: "replaceAdminCatalog",
        summary: "replaceAdminCatalog",
        security: [
          {
            bearer: [],
          },
          {
            session: [],
          },
        ],
        "x-required-capabilities": ["admin:read", "billing:configure"],
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Catalog",
                },
              },
            },
            headers: {
              ETag: {
                description: "Quoted catalog revision",
                schema: {
                  type: "string",
                },
              },
            },
          },
          "401": {
            description: "Session expired or unauthenticated",
          },
          "403": {
            description: "Insufficient management permission or invalid Origin",
          },
          "404": {
            description: "User or grant not found",
          },
          "409": {
            description: "Environment, preview or grant state conflict",
          },
          "422": {
            description: "Invalid input",
          },
          "500": {
            description: "Operation failed; inspect state before retrying",
          },
          "412": {
            description: "Catalog revision changed",
          },
          "428": {
            description: "If-Match required",
          },
        },
        parameters: [
          {
            name: "If-Match",
            in: "header",
            required: true,
            schema: {
              type: "string",
            },
          },
          {
            name: "Admin-Environment",
            in: "header",
            required: true,
            schema: {
              $ref: "#/components/schemas/Environment",
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/Catalog",
              },
            },
          },
        },
      },
    },
    "/customers": {
      get: {
        operationId: "listAdminCustomers",
        summary: "List payment customers in the selected environment",
        description:
          "Bounded page-number pagination ordered by ownerSub. Search is a literal substring of the user or RevenueCat ID. Count and rows are read in one database batch. Lists contain payment accounts, not all identity-provider users.",
        security: [
          {
            bearer: [],
          },
          {
            session: [],
          },
        ],
        "x-required-capabilities": ["admin:read"],
        parameters: [
          {
            name: "page",
            in: "query",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 1000000,
              default: 1,
            },
          },
          {
            name: "pageSize",
            in: "query",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 50,
              default: 20,
            },
          },
          {
            name: "query",
            in: "query",
            schema: {
              type: "string",
              maxLength: 200,
              default: "",
            },
          },
        ],
        responses: {
          "200": {
            description: "Customer page",
            headers: {
              Link: {
                description:
                  "First, previous, next and last page links when applicable",
                schema: {
                  type: "string",
                },
              },
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Customers",
                },
              },
            },
          },
          "401": {
            description: "Unauthenticated",
          },
          "403": {
            description: "Environment access denied",
          },
          "422": {
            description: "Invalid pagination or search",
          },
          "500": {
            description: "Read failed",
          },
        },
      },
    },
    "/events": {
      get: {
        operationId: "listAdminPaymentEvents",
        summary: "List successfully processed payment notification receipts",
        description:
          "Environment-scoped receipts ordered by processing time descending, then ID. These are not complete transaction, failure or delivery histories.",
        security: [
          {
            bearer: [],
          },
          {
            session: [],
          },
        ],
        "x-required-capabilities": ["admin:read"],
        parameters: [
          {
            name: "page",
            in: "query",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 1000000,
              default: 1,
            },
          },
          {
            name: "pageSize",
            in: "query",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 50,
              default: 20,
            },
          },
        ],
        responses: {
          "200": {
            description: "Processed event page",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Events",
                },
              },
            },
          },
          "401": {
            description: "Unauthenticated",
          },
          "403": {
            description: "Environment access denied",
          },
          "422": {
            description: "Invalid pagination or search",
          },
          "500": {
            description: "Read failed",
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      session: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-appbase-admin",
        description:
          "OIDC BFF session. Every operation also requires host-authorized administrative capabilities; customer sessions alone never suffice.",
      },
      bearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      Capability: {
        type: "object",
        properties: {
          limit: {
            type: ["integer", "null"],
            minimum: 0,
          },
          period: {
            enum: ["lifetime", "utc_month"],
          },
        },
        required: ["limit", "period"],
        additionalProperties: false,
      },
      Plan: {
        type: "object",
        properties: {
          id: {
            type: "string",
          },
          capabilities: {
            type: "object",
            additionalProperties: {
              $ref: "#/components/schemas/Capability",
            },
          },
          displayName: {
            type: "string",
            minLength: 1,
            maxLength: 100,
          },
        },
        required: ["id", "capabilities"],
        additionalProperties: false,
      },
      Catalog: {
        type: "object",
        properties: {
          freePlan: {
            $ref: "#/components/schemas/Plan",
          },
          plans: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Plan",
            },
          },
          entitlementPlans: {
            type: "object",
            additionalProperties: {
              type: "string",
            },
          },
          honorGracePeriod: {
            type: "boolean",
          },
        },
        required: ["freePlan", "plans", "entitlementPlans", "honorGracePeriod"],
        additionalProperties: false,
      },
      Entitlement: {
        type: "object",
        properties: {
          id: {
            type: "string",
          },
          productId: {
            type: "string",
          },
          store: {
            type: "string",
          },
          sandbox: {
            type: "boolean",
          },
          startsAt: {
            type: "string",
            format: "date-time",
          },
          expiresAt: {
            type: ["string", "null"],
            format: "date-time",
          },
          graceEndsAt: {
            type: ["string", "null"],
            format: "date-time",
          },
          willRenew: {
            type: "boolean",
          },
        },
        required: [
          "id",
          "productId",
          "store",
          "sandbox",
          "startsAt",
          "expiresAt",
          "graceEndsAt",
          "willRenew",
        ],
        additionalProperties: false,
      },
      Environment: {
        type: "string",
        enum: ["production", "sandbox"],
      },
      Snapshot: {
        type: "object",
        properties: {
          planId: {
            type: "string",
          },
          grantEndsAt: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "null",
              },
            ],
          },
          capabilities: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                limit: {
                  anyOf: [
                    {
                      type: "integer",
                      minimum: 0,
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                period: {
                  type: "string",
                  enum: ["lifetime", "utc_month"],
                },
                used: {
                  type: ["integer", "null"],
                  minimum: 0,
                  description: "Recorded usage, or null when unavailable.",
                },
                periodKey: {
                  type: "string",
                },
              },
              required: ["limit", "period", "used", "periodKey"],
              additionalProperties: false,
            },
          },
          displayName: {
            type: "string",
          },
          isPaid: {
            type: "boolean",
          },
        },
        required: [
          "planId",
          "grantEndsAt",
          "capabilities",
          "displayName",
          "isPaid",
        ],
        additionalProperties: false,
      },
      User: {
        type: "object",
        properties: {
          ownerSub: {
            type: "string",
          },
          appUserId: {
            type: "string",
          },
          membership: {
            $ref: "#/components/schemas/Snapshot",
          },
          subscription: {
            anyOf: [
              {
                type: "object",
                properties: {
                  observedAt: {
                    type: "string",
                  },
                  entitlements: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/Entitlement",
                    },
                  },
                },
                required: ["observedAt", "entitlements"],
                additionalProperties: false,
              },
              {
                type: "null",
              },
            ],
          },
          source: {
            type: "string",
            enum: ["subscription", "legacy", "default"],
          },
          access: {
            type: "array",
            items: {
              type: "object",
              properties: {
                entitlementId: {
                  type: "string",
                },
                kind: {
                  enum: ["purchased", "complimentary", "unknown"],
                },
                status: {
                  enum: [
                    "other_environment",
                    "scheduled",
                    "active",
                    "grace_period",
                    "expired",
                  ],
                },
              },
              required: ["entitlementId", "kind", "status"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "ownerSub",
          "membership",
          "subscription",
          "source",
          "access",
        ],
        additionalProperties: false,
      },
      Context: {
        type: "object",
        properties: {
          environment: {
            $ref: "#/components/schemas/Environment",
          },
          productName: {
            type: "string",
          },
          operator: {
            type: "string",
          },
          environments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                },
                url: {
                  type: "string",
                  format: "uri",
                },
              },
              required: ["name", "url"],
              additionalProperties: false,
            },
          },
          canConfigure: {
            type: "boolean",
          },
          benefits: {
            type: "object",
            description:
              "App-owned execution semantics, not writable through the catalog. Empty for hosts without a registry.",
            additionalProperties: {
              $ref: "#/components/schemas/BenefitDefinition",
            },
          },
          paymentProvider: {
            anyOf: [
              {
                $ref: "#/components/schemas/PaymentConfiguration",
              },
              {
                type: "null",
              },
            ],
          },
          canInspectEvents: {
            type: "boolean",
          },
          catalogInitialized: {
            type: "boolean",
          },
          benefitSchema: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                displayName: {
                  type: "string",
                },
                description: {
                  type: "string",
                },
                unit: {
                  type: "string",
                },
                type: {
                  type: "string",
                  enum: ["quota"],
                },
                period: {
                  type: "string",
                  enum: ["lifetime", "utc_month"],
                },
              },
              required: [
                "type",
                "period",
                "displayName",
                "description",
                "unit",
              ],
            },
          },
        },
        required: [
          "environment",
          "productName",
          "operator",
          "environments",
          "canConfigure",
          "benefits",
          "paymentProvider",
          "canInspectEvents",
          "catalogInitialized",
          "benefitSchema",
        ],
        additionalProperties: false,
      },
      Customer: {
        type: "object",
        properties: {
          ownerSub: {
            type: "string",
          },
          appUserId: {
            type: "string",
          },
          planId: {
            type: "string",
          },
          planName: {
            type: "string",
          },
          isPaid: {
            type: "boolean",
          },
          synchronizedAt: {
            type: ["string", "null"],
            format: "date-time",
          },
        },
        required: [
          "ownerSub",
          "appUserId",
          "planId",
          "planName",
          "isPaid",
          "synchronizedAt",
        ],
        additionalProperties: false,
      },
      Customers: {
        type: "object",
        required: ["items", "pagination"],
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Customer",
            },
          },
          pagination: {
            type: "object",
            properties: {
              page: {
                type: "integer",
                minimum: 1,
              },
              pageSize: {
                type: "integer",
                minimum: 1,
                maximum: 50,
              },
              totalItems: {
                type: "integer",
                minimum: 0,
              },
              totalPages: {
                type: "integer",
                minimum: 0,
              },
            },
            required: ["page", "pageSize", "totalItems", "totalPages"],
            additionalProperties: false,
          },
        },
      },
      BenefitDefinition: {
        type: "object",
        properties: {
          displayName: {
            type: "string",
          },
          description: {
            type: "string",
          },
          unit: {
            type: "string",
          },
        },
        required: ["displayName", "description", "unit"],
        additionalProperties: false,
      },
      PaymentConfiguration: {
        type: "object",
        properties: {
          providerId: {
            type: "string",
          },
          providerName: {
            type: "string",
          },
          dashboardUrl: {
            type: ["string", "null"],
            format: "uri",
          },
          webhookPath: {
            type: ["string", "null"],
          },
          settings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                },
                configured: {
                  type: "boolean",
                },
              },
              required: ["name", "configured"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "providerId",
          "providerName",
          "dashboardUrl",
          "webhookPath",
          "settings",
        ],
        additionalProperties: false,
      },
      Events: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                },
                processedAt: {
                  type: "string",
                  format: "date-time",
                },
              },
              required: ["id", "processedAt"],
              additionalProperties: false,
            },
          },
          totalItems: {
            type: "integer",
            minimum: 0,
          },
          page: {
            type: "integer",
            minimum: 1,
          },
          pageSize: {
            type: "integer",
            minimum: 1,
            maximum: 50,
          },
          totalPages: {
            type: "integer",
            minimum: 0,
          },
        },
        required: ["items", "totalItems", "page", "pageSize", "totalPages"],
        additionalProperties: false,
      },
    },
  },
} as const;
