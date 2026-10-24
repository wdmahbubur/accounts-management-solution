export * from "./command.ts";
export * from "./company-locale.ts";

export const contractsModule = {
  name: "contracts",
  responsibility:
    "Shared request, response, error and DTO contracts at trusted boundaries."
} as const;
