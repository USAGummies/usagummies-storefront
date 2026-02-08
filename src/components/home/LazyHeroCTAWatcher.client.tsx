// src/components/home/LazyHeroCTAWatcher.client.tsx
"use client";

import dynamic from "next/dynamic";

const HeroCTAWatcher = dynamic(() => import("./HeroCTAWatcher"), { ssr: false });

export default function LazyHeroCTAWatcher() {
  return <HeroCTAWatcher />;
}
