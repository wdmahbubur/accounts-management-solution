import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoUntrustedAuthorityFields,
  ContractValidationError,
  parseExpectedVersion,
  parseMoneyString,
  parseOrganizationId,
  type RequestId,
  type Uuid
} from "../packages/contracts/src/index.ts";
import { capability } from "../packages/permissions/src/index.ts";
import {
  createOrganizationRouteHandler
} from "../apps/web/server/commands/route-adapter.ts";
import {
  createOrganizationServerAction
} from "../apps/web/server/commands/action-adapter.ts";
import {
  CommandError
} from "../apps/web/server/commands/errors.ts";
import type {
  CommandExecutionDependencies,
  OrganizationCommandDefinition
} from "../apps/web/server/commands/types.ts";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A = "11111111-1111-4111-8111-111111111111";
const MEMBER_A = "22222222-2222-4222-8222-222222222222";

type Input = { expected_version: number; amount: string };
type Output = { accepted: true; member_id: string };

function command(calls: { count: number }): OrganizationCommandDefinition<Input, Output> {
  return {
    operation: "document.post",
    capability: capability("documents.post"),
    idempotency: "required",
    validate(raw) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw CommandError.validation({ body: "Expected a JSON object." });
      }
      const body = raw as Record<string, unknown>;
      return {
        expected_version: parseExpectedVersion(body.expected_version),
        amount: parseMoneyString(body.amount)
      };
    },
    async execute(context) {
      calls.count += 1;
      return { accepted: true, member_id: context.actor.memberId };
    }
  };
}

function dependencies(options?: {
  authenticated?: boolean;
  capabilities?: readonly string[];
  memberOrganizationId?: string;
}): CommandExecutionDependencies {
  return {
    identityVerifier: {
      async verifyIdentity() {
        return options?.authenticated === false
          ? null
          : { userId: USER_A as Uuid };
      }
    },
    membershipResolver: {
      async resolveActiveMembership({ organizationId }) {
        return {
          memberId: MEMBER_A as Uuid,
          organizationId: parseOrganizationId(
            options?.memberOrganizationId ?? organizationId
          ),
          capabilities: options?.capabilities ?? ["documents.post"]
        };
      }
    },
    generateRequestId() {
      return "req_test" as RequestId;
    },
    hashRequest() {
      return "hash_test";
    }
  };
}

const validPayload = {
  expected_version: 4,
  amount: "10000.00"
};

const idempotencyHeaders = {
  "content-type": "application/json",
  "idempotency-key": "0123456789abcdef0123456789abcdef"
};

test("money and expected-version contracts reject non-canonical authority inputs", () => {
  assert.equal(parseMoneyString("10000.00"), "10000.00");
  assert.throws(() => parseMoneyString(10000), ContractValidationError);
  assert.throws(() => parseMoneyString("10000.0"), ContractValidationError);
  assert.throws(() => parseMoneyString("NaN"), ContractValidationError);
  assert.equal(parseExpectedVersion(4), 4);
  assert.throws(() => parseExpectedVersion(0), ContractValidationError);
  assert.throws(
    () => assertNoUntrustedAuthorityFields({ actor_id: USER_A }),
    ContractValidationError
  );
  assert.throws(
    () => assertNoUntrustedAuthorityFields({ nested: { user_metadata: { role: "Owner" } } }),
    ContractValidationError
  );
});

test("S-05 route handler direct invocation enforces capability before shared command", async () => {
  const calls = { count: 0 };
  const handler = createOrganizationRouteHandler({
    definition: command(calls),
    dependencies: dependencies({ capabilities: [] })
  });

  const response = await handler(
    new Request(`http://localhost/api/v1/organizations/${ORG_A}/documents/x/post`, {
      method: "POST",
      headers: idempotencyHeaders,
      body: JSON.stringify(validPayload)
    }),
    { params: Promise.resolve({ organizationId: ORG_A }) }
  );

  assert.equal(response.status, 403);
  assert.equal(calls.count, 0);
  const body = await response.json();
  assert.equal(body.error.code, "FORBIDDEN");
});

test("S-05 server action direct invocation uses the same capability gate and command", async () => {
  const calls = { count: 0 };
  const action = createOrganizationServerAction({
    definition: command(calls),
    dependencies: dependencies({ capabilities: ["documents.post"] }),
    headersProvider: async () => new Headers(idempotencyHeaders)
  });

  const result = await action(ORG_A, validPayload);
  assert.equal("data" in result, true);
  if ("data" in result) {
    assert.equal(result.data.member_id, MEMBER_A);
  }
  assert.equal(calls.count, 1);
});

test("S-06 anonymous direct invocation is denied before domain execution", async () => {
  const calls = { count: 0 };
  const handler = createOrganizationRouteHandler({
    definition: command(calls),
    dependencies: dependencies({ authenticated: false })
  });

  const response = await handler(
    new Request(`http://localhost/api/v1/organizations/${ORG_A}/documents/x/post`, {
      method: "POST",
      headers: idempotencyHeaders,
      body: JSON.stringify(validPayload)
    }),
    { params: Promise.resolve({ organizationId: ORG_A }) }
  );

  assert.equal(response.status, 401);
  assert.equal(calls.count, 0);
  assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
});

test("S-06 forged actor, organization and role payload fields are rejected", async () => {
  for (const forged of [
    { ...validPayload, actor_id: "33333333-3333-4333-8333-333333333333" },
    { ...validPayload, organization_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { ...validPayload, role: "Owner" }
  ]) {
    const calls = { count: 0 };
    const action = createOrganizationServerAction({
      definition: command(calls),
      dependencies: dependencies(),
      headersProvider: async () => new Headers(idempotencyHeaders)
    });

    const result = await action(ORG_A, forged);
    assert.equal("error" in result, true);
    if ("error" in result) {
      assert.equal(result.error.code, "VALIDATION_FAILED");
    }
    assert.equal(calls.count, 0);
  }
});

test("inaccessible organization is masked as NOT_FOUND", async () => {
  const calls = { count: 0 };
  const action = createOrganizationServerAction({
    definition: command(calls),
    dependencies: dependencies({
      memberOrganizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    }),
    headersProvider: async () => new Headers(idempotencyHeaders)
  });

  const result = await action(ORG_A, validPayload);
  assert.equal("error" in result, true);
  if ("error" in result) {
    assert.equal(result.error.code, "NOT_FOUND");
  }
  assert.equal(calls.count, 0);
});

test("documented stale-version, period-lock and idempotency conflicts map to 409", () => {
  for (const code of ["STALE_VERSION", "PERIOD_LOCKED", "IDEMPOTENCY_CONFLICT"] as const) {
    assert.equal(CommandError.conflict(code).status, 409);
  }
});


test("S-05 server action direct invocation cannot bypass capability checks", async () => {
  const calls = { count: 0 };
  const action = createOrganizationServerAction({
    definition: command(calls),
    dependencies: dependencies({ capabilities: [] }),
    headersProvider: async () => new Headers(idempotencyHeaders)
  });

  const result = await action(ORG_A, validPayload);
  assert.equal("error" in result, true);
  if ("error" in result) {
    assert.equal(result.error.code, "FORBIDDEN");
  }
  assert.equal(calls.count, 0);
});

test("material command requires a strong idempotency key before domain execution", async () => {
  const calls = { count: 0 };
  const action = createOrganizationServerAction({
    definition: command(calls),
    dependencies: dependencies(),
    headersProvider: async () => new Headers({ "content-type": "application/json" })
  });

  const result = await action(ORG_A, validPayload);
  assert.equal("error" in result, true);
  if ("error" in result) {
    assert.equal(result.error.code, "VALIDATION_FAILED");
    assert.equal(result.error.fields?.idempotency_key.includes("128"), true);
  }
  assert.equal(calls.count, 0);
});

test("validated client correlation ID is preserved on a successful command", async () => {
  const calls = { count: 0 };
  const action = createOrganizationServerAction({
    definition: command(calls),
    dependencies: dependencies(),
    headersProvider: async () =>
      new Headers({
        ...idempotencyHeaders,
        "x-request-id": "client-correlation-123"
      })
  });

  const result = await action(ORG_A, validPayload);
  assert.equal("data" in result, true);
  assert.equal(result.meta.request_id, "client-correlation-123");
  assert.equal(calls.count, 1);
});
