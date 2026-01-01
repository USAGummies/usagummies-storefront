// src/lib/shopify/index.ts
// Canonical re-exports so "@/lib/shopify" is stable across the codebase.

export { storefrontFetch as shopifyFetch } from "./storefront";
export * from "./products";
