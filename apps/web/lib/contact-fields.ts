import { contactObject, detailLabel, readableContactEntries, type ContactDetail, type ContactFieldDefinition } from "./contact-details.ts";

export type ContactEditField = ContactFieldDefinition & { key: string; value: string; readOnly: boolean };
export function contactEditFields(value: unknown, definitions: readonly ContactFieldDefinition[]): ContactEditField[] {
  const original = contactObject(value);
  return definitions.map(definition => {
    const key = definition.keys.find(key => Object.hasOwn(original, key)) ?? definition.keys[0];
    const existing = original[key];
    return { ...definition, key, value: typeof existing === "string" ? existing : "",
      readOnly: existing !== undefined && existing !== null && typeof existing !== "string" };
  });
}
export function additionalContactDetails(value: unknown, definitions: readonly ContactFieldDefinition[]): ContactDetail[] {
  const fields = contactEditFields(value, definitions), editableKeys = new Set(fields.filter(field => !field.readOnly).map(field => field.key));
  return Object.entries(contactObject(value)).filter(([key]) => !editableKeys.has(key))
    .flatMap(([key, item]) => readableContactEntries(item, detailLabel(key)));
}

/** Change only the explicitly edited, supported string fields; legacy JSON survives unchanged. */
export function mergeContactFields(original: unknown, definitions: readonly ContactFieldDefinition[], values: Readonly<Record<string, string>>): Record<string, unknown> {
  const merged = { ...contactObject(original) };
  for (const field of contactEditFields(original, definitions)) {
    const value = values[field.name];
    if (field.readOnly || value === undefined || value === field.value) continue;
    if (value.trim()) merged[field.key] = value.trim();
    else delete merged[field.key];
  }
  return merged;
}
