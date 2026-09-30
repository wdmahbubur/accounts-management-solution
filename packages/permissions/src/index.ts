export type Capability = string & { readonly __brand: "Capability" };

const CAPABILITY_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;

export function capability(value: string): Capability {
  if (!CAPABILITY_PATTERN.test(value)) {
    throw new Error(`Invalid capability name: ${value}`);
  }
  return value as Capability;
}

export function hasCapability(
  granted: readonly string[],
  required: Capability
): boolean {
  return granted.includes(required);
}

export const permissionsModule = {
  name: "permissions",
  responsibility:
    "Capability vocabulary and authorization contracts; never client-side authority."
} as const;
