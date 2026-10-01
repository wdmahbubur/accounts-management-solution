import type { OrganizationId } from "@ams/contracts";

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function organizationQueryKey(
  organizationId: OrganizationId,
  ...parts: readonly string[]
): readonly string[] {
  return ["organization", organizationId, ...parts] as const;
}

export function organizationCacheTag(
  organizationId: OrganizationId,
  namespace: string
): string {
  return `org:${organizationId}:cache:${segment(namespace)}`;
}

export function organizationDownloadJobKey(
  organizationId: OrganizationId,
  jobId: string
): string {
  return `org:${organizationId}:download:${segment(jobId)}`;
}
