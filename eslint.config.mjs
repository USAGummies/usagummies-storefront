// eslint.config.mjs — simplified to avoid missing dependencies while keeping key rules
import js from "@eslint/js";
import globals from "globals";
import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  { ignores: [".next/**", "node_modules/**", "out/**", "dist/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parser: tsParser,
    },
    plugins: {
      "@next/next": nextPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "@typescript-eslint": tsPlugin,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@next/next/no-html-link-for-pages": "error",
      "@next/next/no-img-element": "warn",
      "react/no-danger": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
