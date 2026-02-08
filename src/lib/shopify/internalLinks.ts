import { cache } from "react";
import { storefrontFetch } from "./storefront";

export type InternalLinkProduct = {
  id: string;
  handle: string;
  title: string;
  productType: string;
  tags: string[];
  createdAt: string;
  featuredImage?: { url: string; altText?: string | null } | null;
  priceRange: {
    minVariantPrice: { amount: string; currencyCode: string };
  };
  collections?: { nodes: Array<{ title: string; handle: string }> } | null;
  seoKeywords?: { value: string | null } | null;
  seoCategory?: { value: string | null } | null;
};

type ProductsQueryResponse = {
  products: {
    nodes: InternalLinkProduct[];
  };
};

const INTERNAL_PRODUCTS_QUERY = /* GraphQL */ `
  query InternalLinkProducts($first: Int!) {
    products(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        handle
        title
        productType
        tags
        createdAt
        featuredImage { url altText }
        priceRange { minVariantPrice { amount currencyCode } }
        collections(first: 6) { nodes { title handle } }
        seoKeywords: metafield(namespace: "seo", key: "keywords") { value }
        seoCategory: metafield(namespace: "seo", key: "category") { value }
      }
    }
  }
`;

export const getProductsForInternalLinks = cache(
  async (first = 50): Promise<InternalLinkProduct[]> => {
    const data = await storefrontFetch<ProductsQueryResponse>({
      query: INTERNAL_PRODUCTS_QUERY,
      variables: { first },
      tags: ["products", "internal-links"],
      revalidate: 300,
    });

    return data?.products?.nodes ?? [];
  }
);
