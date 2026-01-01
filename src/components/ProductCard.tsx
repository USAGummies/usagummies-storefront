import Link from "next/link";

type Product = {
  id: string;
  title: string;
  handle: string;
  variants: {
    id: string;
    price: {
      amount: string;
    };
  }[];
};

export function ProductCard({ product }: { product: Product }) {
  const variant = product.variants[0];

  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        padding: "1.5rem",
        borderRadius: "6px",
      }}
    >
      <h2 style={{ marginBottom: "0.5rem" }}>{product.title}</h2>
      <p style={{ marginBottom: "1rem" }}>
        ${variant.price.amount}
      </p>

      <Link href={`/products/${product.handle}`}>
        <button
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          View Product
        </button>
      </Link>
    </div>
  );
}
