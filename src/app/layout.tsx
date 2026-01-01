// src/app/layout.tsx (FULL REPLACE)
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "USA Gummies",
  description: "Premium American-made gummy bears.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900">
        <header className="border-b bg-[#fbf2e8]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link href="/" className="flex items-center gap-3">
              <span className="text-lg font-black tracking-tight">
                USA GUMMIES
              </span>
              <span className="text-sm">🇺🇸 American-Made</span>
            </Link>

            <nav className="flex items-center gap-4 text-sm font-semibold">
              <Link href="/shop" className="underline">
                Shop
              </Link>
              <Link href="/cart" className="underline">
                Cart
              </Link>
            </nav>
          </div>
        </header>

        {children}

        <footer className="border-t bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-10 text-sm text-neutral-700">
            <div>Built in America. Shipped fast.</div>
            <div className="flex gap-3">
              <Link href="/policies" className="underline">
                Policies
              </Link>
              <Link href="/shipping" className="underline">
                Shipping
              </Link>
              <Link href="/contact" className="underline">
                Contact
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
