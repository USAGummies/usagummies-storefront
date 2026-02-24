/**
 * GET /api/ops/wholesale/products — Fetch product catalog for wholesale ordering
 *
 * Uses the Shopify Storefront API to get products + variants + pricing.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STOREFRONT_ENDPOINT =
  process.env.SHOPIFY_STOREFRONT_API_ENDPOINT ||
  process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_ENDPOINT ||
  "";

const STOREFRONT_TOKEN =
  process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
  "";

const PRODUCTS_QUERY = `
  query {
    products(first: 50) {
      edges {
        node {
          id
          title
          handle
          featuredImage { url altText }
          variants(first: 20) {
            edges {
              node {
                id
                title
                availableForSale
                price { amount currencyCode }
                quantityAvailable
              }
            }
          }
        }
      }
    }
  }
`;

export async function GET() {
  if (!STOREFRONT_ENDPOINT || !STOREFRONT_TOKEN) {
    return NextResponse.json({ error: "Shopify not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(STOREFRONT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": STOREFRONT_TOKEN,
      },
      body: JSON.stringify({ query: PRODUCTS_QUERY }),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Shopify ${res.status}` }, { status: 502 });
    }

    const json = await res.json();
    const products = (json.data?.products?.edges || []).map(
      (e: { node: Record<string, unknown> }) => {
        const p = e.node as Record<string, unknown>;
        const variants = ((p.variants as { edges: Array<{ node: Record<string, unknown> }> })?.edges || []).map(
          (v: { node: Record<string, unknown> }) => ({
            id: v.node.id,
            title: v.node.title,
            available: v.node.availableForSale,
            price: (v.node.price as { amount: string })?.amount,
            currency: (v.node.price as { currencyCode: string })?.currencyCode,
            qty: v.node.quantityAvailable,
          })
        );
        return {
          id: p.id,
          title: p.title,
          handle: p.handle,
          image: (p.featuredImage as { url?: string })?.url || null,
          variants,
        };
      }
    );

    return NextResponse.json({ products });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
