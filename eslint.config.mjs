import { globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    "**/.next/**",
    "**/node_modules/**",
    "docs/**",
    ".github/handoff/**"
  ])
];

export default eslintConfig;
