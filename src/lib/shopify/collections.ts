import "server-only";
import { cache } from "react";
import { storefrontFetch } from "./storefront";

export type CollectionProduct = {
  id: string;
  handle: string;
  title: string;
  availableForSale?: boolean;
  featuredImage?: {
    url: string;
    altText?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
  priceRange?: {
    minVariantPrice?: { amount: string; currencyCode: string };
  };
  variants?: {
    nodes?: Array<{ id: string; price?: { amount: string; currencyCode: string } }>;
  };
};

export type CollectionByHandle = {
  id: string;
  handle: string;
  title: string;
  description?: string | null;
  descriptionHtml?: string | null;
  updatedAt?: string | null;
  seo?: { title?: string | null; description?: string | null } | null;
  image?: { url: string; altText?: string | null; width?: number | null; height?: number | null } | null;
  products?: { nodes: CollectionProduct[] } | null;
};

type CollectionByHandleResult = {
  collectionByHandle: CollectionByHandle | null;
};

const COLLECTION_PRODUCT_FIELDS = /* GraphQL */ `
  fragment CollectionProductFields on Product {
    id
    handle
    title
    availableForSale
    featuredImage {
      url
      altText
      width
      height
    }
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
    variants(first: 1) {
      nodes {
        id
        price {
          amount
          currencyCode
        }
      }
    }
  }
`;

const COLLECTION_BY_HANDLE_QUERY = /* GraphQL */ `
  ${COLLECTION_PRODUCT_FIELDS}
  query CollectionByHandle($handle: String!, $first: Int!) {
    collectionByHandle(handle: $handle) {
      id
      handle
      title
      description
      descriptionHtml
      updatedAt
      seo {
        title
        description
      }
      image {
        url
        altText
        width
        height
      }
      products(first: $first) {
        nodes {
          ...CollectionProductFields
        }
      }
    }
  }
`;

export const getCollectionByHandle = cache(async (handle: string, opts?: { pageSize?: number }) => {
  const pageSize = Math.max(1, Math.min(100, opts?.pageSize ?? 48));

  const data = await storefrontFetch<CollectionByHandleResult>({
    query: COLLECTION_BY_HANDLE_QUERY,
    variables: { handle, first: pageSize },
    tags: ["collections", `collection:${handle}`],
    revalidate: 3600,
  });

  return data?.collectionByHandle ?? null;
});
