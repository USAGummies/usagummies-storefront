import "server-only";
import { cache } from "react";
import { storefrontFetch } from "./storefront";

export type ShopifyPage = {
  id: string;
  handle: string;
  title: string;
  body?: string | null;
  bodySummary?: string | null;
  updatedAt?: string | null;
  seo?: { title?: string | null; description?: string | null } | null;
};

type PageByHandleResult = {
  page: ShopifyPage | null;
};

const PAGE_BY_HANDLE_QUERY = /* GraphQL */ `
  query PageByHandle($handle: String!) {
    page(handle: $handle) {
      id
      handle
      title
      body
      bodySummary
      updatedAt
      seo {
        title
        description
      }
    }
  }
`;

export const getPageByHandle = cache(async (handle: string) => {
  const data = await storefrontFetch<PageByHandleResult>({
    query: PAGE_BY_HANDLE_QUERY,
    variables: { handle },
    tags: ["pages", `page:${handle}`],
    revalidate: 3600,
  });

  return data?.page ?? null;
});
