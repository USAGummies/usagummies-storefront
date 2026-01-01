"use client";

export default function AddToCart({ variantId }: { variantId: string }) {
  async function handleClick() {
    const res = await fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId }),
    });

    const data = await res.json();
    window.location.href = data.checkoutUrl;
  }

  return (
    <button
      onClick={handleClick}
      style={{
        padding: "1rem 2rem",
        fontSize: "1rem",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Buy Now
    </button>
  );
}
