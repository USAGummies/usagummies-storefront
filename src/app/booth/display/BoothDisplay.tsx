"use client";

import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";

export function BoothDisplay() {
  // Hide AppShell nav/footer so the display is truly fullscreen
  useEffect(() => {
    const nav = document.querySelector("nav")?.closest("header") || document.querySelector("nav");
    const footer = document.querySelector("footer");
    const els = [nav, footer].filter(Boolean) as HTMLElement[];
    els.forEach((el) => (el.style.display = "none"));
    return () => els.forEach((el) => (el.style.display = ""));
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 9999,
        overflow: "hidden",
        background: "#f8f5f0",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
        cursor: "none",
        userSelect: "none",
      }}
    >
      {/* Top Banner */}
      <div
        style={{
          background: "#1a472a",
          color: "white",
          textAlign: "center",
          padding: "10px 0",
          fontSize: "14px",
          fontWeight: 700,
          letterSpacing: "2px",
          textTransform: "uppercase",
          flexShrink: 0,
        }}
      >
        ★ Free From Artificial Dyes — Made in the USA — Everything Down to the Film ★
      </div>

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          padding: "40px 60px",
          gap: "50px",
          minHeight: 0,
        }}
      >
        {/* Left Column — Sell Points */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "24px",
          }}
        >
          {/* Logo / Brand */}
          <div>
            <h1
              style={{
                fontSize: "52px",
                fontWeight: 800,
                color: "#0a1e3d",
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              USA Gummies
            </h1>
            <p
              style={{
                fontSize: "20px",
                color: "#666",
                margin: "8px 0 0 0",
                letterSpacing: "0.5px",
              }}
            >
              America&apos;s Gummy Bear — Premium Dye-Free Wholesale
            </p>
          </div>

          {/* Show Deal Hero */}
          <div
            style={{
              background: "#b22234",
              borderRadius: "16px",
              padding: "28px 32px",
              color: "white",
            }}
          >
            <div
              style={{
                fontSize: "16px",
                fontWeight: 600,
                opacity: 0.9,
                marginBottom: "6px",
                textTransform: "uppercase",
                letterSpacing: "1.5px",
              }}
            >
              Show Special — The Reunion 2026
            </div>
            <div
              style={{
                fontSize: "48px",
                fontWeight: 800,
                lineHeight: 1.1,
              }}
            >
              $3.25/bag · FREE Shipping
            </div>
            <div
              style={{
                fontSize: "18px",
                marginTop: "8px",
                opacity: 0.85,
              }}
            >
              Any master carton order (36+ bags) · $117/MC
            </div>
          </div>

          {/* Key Selling Points */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px",
            }}
          >
            {[
              "100% Made in USA",
              "Free From Artificial Dyes",
              "Natural Colors Only",
              "18-Month Shelf Life",
              "Free of Top 9 Allergens",
              "Dye-Ban Compliant",
              "Strip Clips Included",
              "42–50% Retailer Margin",
            ].map((point) => (
              <div
                key={point}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "16px",
                  color: "#0a1e3d",
                  fontWeight: 600,
                }}
              >
                <span style={{ color: "#b22234", fontSize: "14px" }}>★</span>
                {point}
              </div>
            ))}
          </div>

          {/* Pricing Tiers */}
          <div
            style={{
              display: "flex",
              gap: "16px",
            }}
          >
            <div
              style={{
                flex: 1,
                background: "white",
                borderRadius: "12px",
                padding: "16px 20px",
                border: "2px solid #b22234",
              }}
            >
              <div style={{ fontSize: "13px", color: "#666", fontWeight: 600, textTransform: "uppercase" }}>
                Show Deal
              </div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#b22234" }}>$3.25/bag</div>
              <div style={{ fontSize: "13px", color: "#15803d", fontWeight: 600 }}>FREE SHIPPING</div>
            </div>
            <div
              style={{
                flex: 1,
                background: "white",
                borderRadius: "12px",
                padding: "16px 20px",
                border: "1px solid #ddd",
              }}
            >
              <div style={{ fontSize: "13px", color: "#666", fontWeight: 600, textTransform: "uppercase" }}>
                Volume (6+ MC)
              </div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#0a1e3d" }}>$3.15/bag</div>
              <div style={{ fontSize: "13px", color: "#666" }}>Net 15</div>
            </div>
            <div
              style={{
                flex: 1,
                background: "white",
                borderRadius: "12px",
                padding: "16px 20px",
                border: "1px solid #ddd",
              }}
            >
              <div style={{ fontSize: "13px", color: "#666", fontWeight: 600, textTransform: "uppercase" }}>
                Pallet (25 MC)
              </div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#0a1e3d" }}>$3.00/bag</div>
              <div style={{ fontSize: "13px", color: "#666" }}>Net 30</div>
            </div>
          </div>

          {/* Product Info */}
          <div style={{ fontSize: "14px", color: "#666", lineHeight: 1.6 }}>
            <strong style={{ color: "#0a1e3d" }}>All American Gummy Bears</strong> · 7.5 oz bag · UPC 199284715530
            · Master Carton: 36 bags (6 cases) · Suggested Retail: $4.99–$6.49
          </div>
        </div>

        {/* Right Column — QR Code */}
        <div
          style={{
            width: "360px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "20px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "24px",
              padding: "32px",
              boxShadow: "0 8px 40px rgba(0,0,0,0.12)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "20px",
            }}
          >
            <QRCodeSVG
              value="https://www.usagummies.com/booth"
              size={280}
              level="H"
              bgColor="#ffffff"
              fgColor="#0a1e3d"
            />
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: 800,
                  color: "#0a1e3d",
                  letterSpacing: "1px",
                }}
              >
                SCAN TO ORDER
              </div>
              <div
                style={{
                  fontSize: "15px",
                  color: "#666",
                  marginTop: "4px",
                }}
              >
                usagummies.com/booth
              </div>
            </div>
          </div>

          <div
            style={{
              textAlign: "center",
              fontSize: "15px",
              color: "#0a1e3d",
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontWeight: 700 }}>ben@usagummies.com</div>
            <div>(307) 209-4928</div>
          </div>

          {/* Suggested Retail */}
          <div
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "16px 32px",
              textAlign: "center",
              border: "1px solid #ddd",
            }}
          >
            <div style={{ fontSize: "12px", color: "#666", fontWeight: 600, textTransform: "uppercase" }}>
              Suggested Retail
            </div>
            <div style={{ fontSize: "32px", fontWeight: 800, color: "#0a1e3d" }}>$4.99–$6.49</div>
            <div style={{ fontSize: "13px", color: "#666" }}>42–50% retailer margin</div>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div
        style={{
          background: "#0a1e3d",
          color: "white",
          textAlign: "center",
          padding: "10px 0",
          fontSize: "13px",
          letterSpacing: "0.5px",
          flexShrink: 0,
        }}
      >
        USA Gummies, Inc. · Sheridan, Wyoming · FDA-Registered · cGMP · Everything Made in America · Also on Amazon
      </div>
    </div>
  );
}
