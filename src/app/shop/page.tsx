// src/app/shop/page.tsx (FULL REPLACE)
import Link from "next/link";
import { ShopToolbar } from "@/components/shop/ShopToolbar";
import { ShopProductCard } from "@/components/shop/ShopProductCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { getProductsPage, type SortValue } from "@/lib/shopify/products";

const PAGE_SIZE = 18;

function coerceSort(v?: string): SortValue {
  switch ((v ?? "").toLowerCase()) {
    case "best-selling":
    case "best":
      return "best-selling";
    case "newest":
      return "newest";
    case "price-asc":
      return "price-asc";
    case "price-desc":
      return "price-desc";
    case "featured":
    default:
      return "featured";
  }
}

export default async function ShopPage(props: {
  searchParams: Promise<{
    sort?: string;
    q?: string;
    after?: string;
    before?: string;
  }>;
}) {
  const sp = await props.searchParams;
  const sort = coerceSort(sp.sort);
  const q = (sp.q ?? "").trim() || undefined;
  const after = sp.after || undefined;
  const before = sp.before || undefined;

  const results = await getProductsPage({
    pageSize: PAGE_SIZE,
    sort,
    q,
    after,
    before,
  });

  return (
    <main style={{ padding: "18px 0 54px" }}>
      <div className="container">
        <SectionHeader
          title="Shop USA Gummies"
          sub="Bundle-first pricing. Free shipping at 5+. Secure Shopify checkout."
        />

        <div style={{ marginTop: 14 }}>
          <ShopToolbar />
        </div>

        <div
          style={{
            marginTop: 14,
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          {results.nodes.map((p) => (
            <ShopProductCard key={p.id} product={p} />
          ))}
        </div>

        <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {results.pageInfo.hasPreviousPage && results.pageInfo.startCursor ? (
            <Link
              className="btn"
              href={{
                pathname: "/shop",
                query: {
                  sort,
                  ...(q ? { q } : {}),
                  before: results.pageInfo.startCursor,
                },
              }}
            >
              ← Prev
            </Link>
          ) : null}

          {results.pageInfo.hasNextPage && results.pageInfo.endCursor ? (
            <Link
              className="btn btn-navy"
              href={{
                pathname: "/shop",
                query: {
                  sort,
                  ...(q ? { q } : {}),
                  after: results.pageInfo.endCursor,
                },
              }}
            >
              Next →
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  );
}
