"use server";

import { randomBytes } from "node:crypto";

import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "../../lib/database/server.ts";
import { createMembershipResolver } from "../../server/auth/membership-resolver.ts";
import {
  COMPANY_CONTEXT_COOKIE,
  CURRENT_ORGANIZATION_COOKIE,
  companyCookieOptions
} from "../../server/company-context.ts";

function formValue(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

export async function switchCompanyAction(formData: FormData) {
  const rawOrganizationId = formValue(formData, "organization_id");
  let organizationId;

  try {
    organizationId = parseOrganizationId(rawOrganizationId);
  } catch {
    redirect("/companies?error=not_found");
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/companies");
  }

  const resolver = createMembershipResolver(supabase);
  const membership = await resolver.resolveActiveMembership({
    userId: parseUuid(user.id, "verified_user_id"),
    organizationId
  });

  if (!membership || membership.organizationId !== organizationId) {
    redirect("/companies?error=not_found");
  }

  const cookieStore = await cookies();
  const nonce = randomBytes(16).toString("base64url");
  const options = companyCookieOptions();

  cookieStore.set(CURRENT_ORGANIZATION_COOKIE, organizationId, options);
  cookieStore.set(COMPANY_CONTEXT_COOKIE, nonce, options);

  redirect(`/o/${organizationId}`);
}
