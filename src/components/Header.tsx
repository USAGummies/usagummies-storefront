import Link from "next/link";

export function Header() {
  return (
    <header
      style={{
        padding: "1.5rem",
        borderBottom: "1px solid #e5e5e5",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <Link href="/" style={{ fontWeight: 700 }}>
        USA Gummies
      </Link>
      <nav>
        <Link href="/shop">Shop</Link>
      </nav>
    </header>
  );
}
