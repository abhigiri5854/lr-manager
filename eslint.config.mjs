import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Turns off ESLint rules that clash with Prettier formatting. Must stay last.
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "design/**"]),
]);

export default eslintConfig;
