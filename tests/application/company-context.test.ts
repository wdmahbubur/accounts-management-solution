import assert from "node:assert/strict";
import test from "node:test";

import { parseOrganizationId } from "../../packages/contracts/src/index.ts";
import {
  assertFreshCompanySubmission,
  parseCompanyContext,
  readCompanyContext,
  StaleCompanyContextError
} from "../../apps/web/server/company-context.ts";
import {
  organizationCacheTag,
  organizationDownloadJobKey,
  organizationQueryKey
} from "../../apps/web/server/tenant-scope.ts";

const ORG_A = parseOrganizationId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const ORG_B = parseOrganizationId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const NONCE_A1 = "aaaaaaaaaaaaaaaaaaaaaa";
const NONCE_A2 = "cccccccccccccccccccccc";
const NONCE_B = "bbbbbbbbbbbbbbbbbbbbbb";

test("US-008 parses company cookies as preference context, not implicit authority", () => {
  const context = readCompanyContext({
    get(name) {
      if (name === "ams_current_organization") {
        return { value: ORG_A };
      }
      if (name === "ams_company_context") {
        return { value: NONCE_A1 };
      }
      return undefined;
    }
  });

  assert.deepEqual(context, { organizationId: ORG_A, nonce: NONCE_A1 });
  assert.equal(parseCompanyContext("not-a-uuid", NONCE_A1), null);
  assert.equal(parseCompanyContext(ORG_A, "short"), null);
});

test("stale cross-company form fails after A to B switch", () => {
  assert.throws(
    () =>
      assertFreshCompanySubmission({
        expectedOrganizationId: ORG_A,
        expectedNonce: NONCE_A1,
        current: { organizationId: ORG_B, nonce: NONCE_B }
      }),
    StaleCompanyContextError
  );
});

test("old A form stays stale even after switching A to B to A again", () => {
  assert.throws(
    () =>
      assertFreshCompanySubmission({
        expectedOrganizationId: ORG_A,
        expectedNonce: NONCE_A1,
        current: { organizationId: ORG_A, nonce: NONCE_A2 }
      }),
    StaleCompanyContextError
  );
});

test("fresh same-company form context is accepted", () => {
  assert.deepEqual(
    assertFreshCompanySubmission({
      expectedOrganizationId: ORG_A,
      expectedNonce: NONCE_A2,
      current: { organizationId: ORG_A, nonce: NONCE_A2 }
    }),
    { organizationId: ORG_A, nonce: NONCE_A2 }
  );
});

test("query/cache/download identities cannot collide across organizations", () => {
  assert.notDeepEqual(
    organizationQueryKey(ORG_A, "dashboard", "2026-10"),
    organizationQueryKey(ORG_B, "dashboard", "2026-10")
  );
  assert.notEqual(
    organizationCacheTag(ORG_A, "dashboard"),
    organizationCacheTag(ORG_B, "dashboard")
  );
  assert.notEqual(
    organizationDownloadJobKey(ORG_A, "job-1"),
    organizationDownloadJobKey(ORG_B, "job-1")
  );
});
