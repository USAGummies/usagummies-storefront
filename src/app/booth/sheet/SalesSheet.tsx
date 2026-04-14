"use client";

import { QRCodeSVG } from "qrcode.react";

export function SalesSheet() {
  const boothUrl = "https://www.usagummies.com/booth";

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          nav, footer, header, .no-print, [class*="banner"], [class*="contentinfo"] { display: none !important; }
          main > div { padding: 0 !important; }
        }
      `}</style>
      <div
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          maxWidth: "8.5in",
          margin: "0 auto",
          padding: "0.5in",
          color: "#0a1e3d",
          background: "white",
        }}
      >
        {/* Top Banner */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "4px solid #b22234",
            paddingBottom: "16px",
            marginBottom: "24px",
          }}
        >
          <div>
            <h1 style={{ fontSize: "2.25rem", fontWeight: 900, letterSpacing: "-0.025em", color: "#0a1e3d", margin: 0 }}>
              USA GUMMIES
            </h1>
            <p style={{ fontSize: "0.875rem", fontWeight: 600, letterSpacing: "0.25em", color: "#b22234", textTransform: "uppercase", marginTop: "2px" }}>
              Made in the USA
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: "0.875rem", color: "#6b7280" }}>
            <p style={{ fontWeight: 600, color: "#0a1e3d", margin: "0 0 2px" }}>ben@usagummies.com</p>
            <p style={{ margin: "0 0 2px" }}>(307) 209-4928</p>
            <p style={{ margin: 0 }}>usagummies.com</p>
          </div>
        </div>

        {/* Hero Line */}
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0a1e3d", margin: 0 }}>
            All American Gummy Bears
          </h2>
          <p style={{ fontSize: "1.125rem", color: "#6b7280", marginTop: "4px" }}>
            Premium dye-free gummy candy — candy that&apos;s better for you
          </p>
        </div>

        {/* Trust Badges */}
        <div style={{ display: "flex", justifyContent: "center", gap: "24px", marginBottom: "32px" }}>
          {["FDA-Registered", "cGMP Certified", "Made in America", "No Artificial Dyes", "All Natural Flavors"].map((badge) => (
            <div key={badge} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.875rem", fontWeight: 500, color: "#0a1e3d" }}>
              <span style={{ color: "#b22234", fontSize: "1rem" }}>&#10003;</span>
              {badge}
            </div>
          ))}
        </div>

        {/* Two Column: Product Info + QR Code */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "32px", marginBottom: "32px" }}>
          {/* Left: Product Details */}
          <div>
            {/* Product Spec */}
            <div style={{ background: "#f8f5f0", borderRadius: "12px", padding: "20px", marginBottom: "20px" }}>
              <h3 style={{ fontWeight: 700, fontSize: "1.125rem", marginBottom: "12px", color: "#0a1e3d", marginTop: 0 }}>Product</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 32px", fontSize: "0.875rem" }}>
                <div><span style={{ color: "#9ca3af" }}>Item:</span> All American Gummy Bears</div>
                <div><span style={{ color: "#9ca3af" }}>Size:</span> 7.5 oz bag</div>
                <div><span style={{ color: "#9ca3af" }}>Master Case:</span> 36 bags (6 inner x 6)</div>
                <div><span style={{ color: "#9ca3af" }}>Shelf Life:</span> 18 months</div>
                <div><span style={{ color: "#9ca3af" }}>UPC:</span> Available on request</div>
                <div><span style={{ color: "#9ca3af" }}>Certifications:</span> FDA, cGMP, Kosher</div>
              </div>
            </div>

            {/* Pricing */}
            <div style={{ marginBottom: "20px" }}>
              <h3 style={{ fontWeight: 700, fontSize: "1.125rem", marginBottom: "12px", color: "#0a1e3d", marginTop: 0 }}>Wholesale Pricing</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div style={{ border: "2px solid #0a1e3d", borderRadius: "12px", padding: "16px" }}>
                  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>Standard</div>
                  <div style={{ fontSize: "1.875rem", fontWeight: 900, color: "#b22234", marginTop: "4px" }}>$3.25<span style={{ fontSize: "1rem", fontWeight: 600 }}>/bag</span></div>
                  <div style={{ fontSize: "0.875rem", color: "#6b7280", marginTop: "8px" }}>$117.00 per master case</div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#15803d", marginTop: "4px" }}>Free shipping included</div>
                </div>
                <div style={{ border: "2px solid #0a1e3d", borderRadius: "12px", padding: "16px" }}>
                  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>Pallet</div>
                  <div style={{ fontSize: "1.875rem", fontWeight: 900, color: "#b22234", marginTop: "4px" }}>$3.00<span style={{ fontSize: "1rem", fontWeight: 600 }}>/bag</span></div>
                  <div style={{ fontSize: "0.875rem", color: "#6b7280", marginTop: "8px" }}>$108.00 per master case</div>
                  <div style={{ fontSize: "0.875rem", color: "#6b7280", marginTop: "4px" }}>Buyer arranges freight</div>
                </div>
              </div>
            </div>

            {/* Margins callout */}
            <div style={{ background: "#0a1e3d", color: "white", borderRadius: "12px", padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.125rem" }}>Retailer Margins</div>
                <div style={{ fontSize: "0.875rem", color: "#d1d5db" }}>At $5.99-$6.99 suggested retail</div>
              </div>
              <div style={{ fontSize: "1.875rem", fontWeight: 900 }}>45-55%</div>
            </div>
          </div>

          {/* Right: QR Code + CTA */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "white", border: "2px solid #0a1e3d", borderRadius: "16px", padding: "20px", textAlign: "center" }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.15em", color: "#b22234", marginBottom: "12px", marginTop: 0 }}>
                Scan to Order
              </p>
              <QRCodeSVG
                value={boothUrl}
                size={180}
                level="H"
                fgColor="#0a1e3d"
                includeMargin={false}
              />
              <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "12px", maxWidth: "180px" }}>
                Start your wholesale order right from your phone
              </p>
            </div>
            <div style={{ marginTop: "16px", textAlign: "center" }}>
              <p style={{ fontSize: "0.75rem", color: "#d1d5db" }}>usagummies.com/booth</p>
            </div>
          </div>
        </div>

        {/* Bottom: Why USA Gummies */}
        <div style={{ borderTop: "2px solid #e5e7eb", paddingTop: "20px" }}>
          <h3 style={{ fontWeight: 700, fontSize: "1.125rem", marginBottom: "12px", color: "#0a1e3d", marginTop: 0 }}>Why Retailers Choose USA Gummies</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px", fontSize: "0.875rem" }}>
            <div>
              <div style={{ fontWeight: 700, color: "#b22234", marginBottom: "4px" }}>Clean Label Trend</div>
              <p style={{ color: "#6b7280", margin: 0 }}>
                Consumers are demanding dye-free options. We&apos;re the only American-made gummy bear with zero artificial colors.
              </p>
            </div>
            <div>
              <div style={{ fontWeight: 700, color: "#b22234", marginBottom: "4px" }}>Made in America</div>
              <p style={{ color: "#6b7280", margin: 0 }}>
                Manufactured in Spokane, WA at an FDA-registered, cGMP-certified facility. Fully domestic supply chain.
              </p>
            </div>
            <div>
              <div style={{ fontWeight: 700, color: "#b22234", marginBottom: "4px" }}>Impulse-Buy Ready</div>
              <p style={{ color: "#6b7280", margin: 0 }}>
                7.5 oz grab-and-go bag at $5.99-$6.99 SRP. Perfect for checkout, candy aisle, souvenir, and gift sections.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem", color: "#d1d5db" }}>
          <span>USA Gummies &bull; C Corporation &bull; Wyoming</span>
          <span>The Reunion — April 2026</span>
        </div>
      </div>
    </>
  );
}
