export const adminOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "AppBase Optional Administration",
    version: "0.1.0",
    license: {
      name: "Apache-2.0",
      identifier: "Apache-2.0",
    },
  },
  servers: [
    {
      url: "https://api.example/admin",
    },
    {
      url: "https://api.example/sandbox/admin",
    },
  ],
  paths: {
    "/context": {
      get: {
        operationId: "getAdminContext",
        summary: "getAdminContext",
        security: [
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
    "/manual-grants": {
      get: {
        operationId: "listManualGrants",
        summary: "listManualGrants",
        security: [
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
                  $ref: "#/components/schemas/GrantPage",
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
            name: "ownerSub",
            in: "query",
            required: true,
            schema: {
              type: "string",
            },
          },
          {
            name: "before",
            in: "query",
            required: false,
            schema: {
              type: "string",
            },
          },
        ],
      },
      post: {
        operationId: "createManualGrant",
        summary: "createManualGrant",
        security: [
          {
            session: [],
          },
        ],
        "x-required-capabilities": ["admin:read", "admin:grants:write"],
        responses: {
          "201": {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ManualGrant",
                },
              },
            },
            headers: {
              Location: {
                description: "Absolute grant resource URL",
                schema: {
                  type: "string",
                  format: "uri",
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
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreateGrant",
              },
            },
          },
        },
      },
    },
    "/manual-grants/{id}": {
      get: {
        operationId: "getManualGrant",
        summary: "getManualGrant",
        security: [
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
                  $ref: "#/components/schemas/ManualGrant",
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
            name: "id",
            in: "path",
            required: true,
            schema: {
              type: "string",
              format: "uuid",
            },
          },
        ],
      },
    },
    "/manual-grants/{id}/revocation": {
      put: {
        operationId: "createManualGrantRevocation",
        summary: "createManualGrantRevocation",
        security: [
          {
            session: [],
          },
        ],
        "x-required-capabilities": ["admin:read", "admin:grants:write"],
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ManualGrant",
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
            name: "id",
            in: "path",
            required: true,
            schema: {
              type: "string",
              format: "uuid",
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreateRevocation",
              },
            },
          },
        },
      },
    },
    "/catalog": {
      get: {
        operationId: "getAdminCatalog",
        summary: "getAdminCatalog",
        security: [
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
        },
      },
      put: {
        operationId: "replaceAdminCatalog",
        summary: "replaceAdminCatalog",
        security: [
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
            minItems: 1,
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
            type: "string",
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
                  type: "integer",
                  minimum: 0,
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
      Revocation: {
        type: "object",
        properties: {
          reason: {
            type: "string",
          },
          createdBy: {
            type: "string",
          },
          createdAt: {
            type: "string",
            format: "date-time",
          },
        },
        required: ["reason", "createdBy", "createdAt"],
        additionalProperties: false,
      },
      ManualGrant: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
          },
          environment: {
            $ref: "#/components/schemas/Environment",
          },
          ownerSub: {
            type: "string",
          },
          planId: {
            type: "string",
          },
          source: {
            type: "string",
            const: "manual",
          },
          startsAt: {
            type: "string",
            format: "date-time",
          },
          endsAt: {
            type: "string",
            format: "date-time",
          },
          reason: {
            type: "string",
          },
          createdBy: {
            type: "string",
          },
          createdAt: {
            type: "string",
            format: "date-time",
          },
          previousPlanId: {
            type: "string",
          },
          catalogRevision: {
            type: "integer",
            minimum: 0,
          },
          revocation: {
            anyOf: [
              {
                $ref: "#/components/schemas/Revocation",
              },
              {
                type: "null",
              },
            ],
          },
        },
        required: [
          "id",
          "environment",
          "ownerSub",
          "planId",
          "source",
          "startsAt",
          "endsAt",
          "reason",
          "createdBy",
          "createdAt",
          "previousPlanId",
          "catalogRevision",
          "revocation",
        ],
        additionalProperties: false,
      },
      CreateGrant: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
          },
          environment: {
            $ref: "#/components/schemas/Environment",
          },
          ownerSub: {
            type: "string",
          },
          planId: {
            type: "string",
          },
          endsAt: {
            type: "string",
            format: "date-time",
          },
          reason: {
            type: "string",
          },
          expectedMembership: {
            $ref: "#/components/schemas/Snapshot",
          },
          expectedCatalogRevision: {
            type: "integer",
            minimum: 0,
          },
          expectedRevision: {
            $ref: "#/components/schemas/AdminRevision",
          },
        },
        required: [
          "id",
          "environment",
          "ownerSub",
          "planId",
          "endsAt",
          "reason",
          "expectedMembership",
          "expectedCatalogRevision",
          "expectedRevision",
        ],
        additionalProperties: false,
      },
      CreateRevocation: {
        type: "object",
        properties: {
          reason: {
            type: "string",
          },
          environment: {
            $ref: "#/components/schemas/Environment",
          },
        },
        required: ["reason", "environment"],
        additionalProperties: false,
      },
      GrantPage: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              $ref: "#/components/schemas/ManualGrant",
            },
          },
          next: {
            anyOf: [
              {
                type: "string",
                format: "uuid",
              },
              {
                type: "null",
              },
            ],
          },
        },
        required: ["items", "next"],
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
          manualGrant: {
            anyOf: [
              {
                $ref: "#/components/schemas/ManualGrant",
              },
              {
                type: "null",
              },
            ],
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
            enum: ["manual", "subscription", "legacy", "default"],
          },
          expectedRevision: {
            $ref: "#/components/schemas/AdminRevision",
          },
        },
        required: [
          "ownerSub",
          "membership",
          "manualGrant",
          "subscription",
          "source",
          "expectedRevision",
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
          canGrant: {
            type: "boolean",
          },
          canConfigure: {
            type: "boolean",
          },
        },
        required: [
          "environment",
          "productName",
          "operator",
          "environments",
          "canGrant",
          "canConfigure",
        ],
        additionalProperties: false,
      },
      AdminRevision: {
        type: "object",
        additionalProperties: false,
        properties: {
          user: {
            type: "integer",
            minimum: 0,
          },
          catalog: {
            type: "integer",
            minimum: 0,
          },
          validUntil: {
            type: "integer",
            minimum: 0,
          },
          catalogFingerprint: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
        },
        required: ["user", "catalog", "validUntil", "catalogFingerprint"],
        description:
          "Opaque optimistic version and Unix-second deadline. Obtain from the user preview and submit unchanged; expired or changed state conflicts.",
      },
    },
  },
} as const;
