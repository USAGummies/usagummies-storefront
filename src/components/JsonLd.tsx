// components/JsonLd.tsx
import React from "react";

export function JsonLd({ data }: { data: Record<string, any> }) {
  return (
    <script
      type="application/ld+json"
      // JSON-LD must be raw string
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
