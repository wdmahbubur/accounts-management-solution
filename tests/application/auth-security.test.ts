import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createSupabaseIdentityVerifier
} from "../../apps/web/server/auth/supabase-identity.ts";
import {
  hasRecentAuthentication,
  requireRecentAuthentication,
  RecentAuthenticationRequiredError
} from "../../apps/web/server/auth/recent-auth.ts";
import { safeNextPath } from "../../apps/web/server/auth/redirects.ts";
import { resolveActorContext } from "../../apps/web/server/auth/resolve-actor.ts";
import { CommandError } from "../../apps/web/server/commands/errors.ts";
import type { OrganizationId, Uuid } from "../../packages/contracts/src/index.ts";

const USER = "11111111-1111-4111-8111-111111111111" as Uuid;
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as OrganizationId;

test("safeNextPath accepts local paths and rejects open-redirect shapes", () => {
  assert.equal(safeNextPath("/settings/security?from=auth"), "/settings/security?from=auth");
  assert.equal(safeNextPath("https://evil.example/x"), "/");
  assert.equal(safeNextPath("//evil.example/x"), "/");
  assert.equal(safeNextPath("/\\evil.example"), "/");
  assert.equal(safeNextPath("settings/security"), "/");
});

test("S-04 verified identity ignores editable metadata authority claims", async () => {
  const client = {
    auth: {
      async getUser() {
        return {
          data: {
            user: {
              id: USER,
              user_metadata: {
                role: "Owner",
                capabilities: ["*"]
              }
            }
          },
          error: null
        };
      }
    }
  } as unknown as Pick<SupabaseClient, "auth">;

  const verifier = createSupabaseIdentityVerifier(client);
  assert.deepEqual(await verifier.verifyIdentity(), { userId: USER });
});

test("S-07 removed member is denied even with a still-valid verified identity", async () => {
  await assert.rejects(
    () =>
      resolveActorContext(ORG, {
        identityVerifier: {
          async verifyIdentity() {
            return { userId: USER };
          }
        },
        membershipResolver: {
          async resolveActiveMembership() {
            return null;
          }
        }
      }),
    (error: unknown) =>
      error instanceof CommandError && error.code === "NOT_FOUND"
  );
});

test("recent-auth policy uses a 24-hour primary sign-in window", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");
  assert.equal(hasRecentAuthentication("2026-09-30T23:00:00.000Z", now), true);
  assert.equal(hasRecentAuthentication("2026-09-29T23:59:59.000Z", now), false);
  assert.equal(hasRecentAuthentication("not-a-date", now), false);
});

test("recent-auth guard rejects missing or stale server-confirmed users", async () => {
  const now = new Date("2026-10-01T00:00:00.000Z");

  await assert.rejects(
    () =>
      requireRecentAuthentication(
        {
          async getUser() {
            return {
              data: {
                user: {
                  id: USER,
                  last_sign_in_at: "2026-09-29T00:00:00.000Z"
                }
              },
              error: null
            };
          }
        },
        now
      ),
    RecentAuthenticationRequiredError
  );
});
