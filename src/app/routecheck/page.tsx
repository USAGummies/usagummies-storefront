import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Routecheck | USA Gummies",
  robots: { index: false, follow: false },
};

export default function RouteCheck() {
  return (
    <div style={{ padding: 24, background: "black", color: "white" }}>
      routecheck ok
    </div>
  );
}
