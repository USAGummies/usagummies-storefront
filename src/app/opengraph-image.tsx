import { ImageResponse } from "next/og";

export const runtime = "edge";
export const contentType = "image/png";
export const size = {
  width: 1200,
  height: 630,
};

const stars = Array.from({ length: 12 }, (_, index) => `star-${index}`);
const stripes = Array.from({ length: 7 }, (_, index) => `stripe-${index}`);

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: "#f8f5ef",
          color: "#0d1c33",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle at 15% 20%, rgba(199, 160, 98, 0.35), transparent 45%), radial-gradient(circle at 90% 5%, rgba(13, 28, 51, 0.12), transparent 45%)",
            opacity: 0.8,
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            width: "100%",
            height: "100%",
            padding: "64px",
            gap: "40px",
            alignItems: "center",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: "18px",
            }}
          >
            <div
              style={{
                fontSize: "16px",
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: "#5f5b56",
                fontWeight: 700,
              }}
            >
              Made in USA
            </div>
            <div
              style={{
                fontSize: "72px",
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
              }}
            >
              USA Gummies
            </div>
            <div
              style={{
                fontSize: "28px",
                color: "#1c2430",
                lineHeight: 1.25,
              }}
            >
              All American gummy bears. Bundle and save.
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div
                style={{
                  padding: "10px 16px",
                  borderRadius: "999px",
                  backgroundColor: "#ffffff",
                  border: "2px solid rgba(13, 28, 51, 0.2)",
                  fontSize: "18px",
                  fontWeight: 700,
                }}
              >
                Try 1 bag on Amazon
              </div>
              <div style={{ fontSize: "16px", color: "#5f5b56" }}>
                No artificial dyes
              </div>
            </div>
          </div>
          <div
            style={{
              width: "320px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "300px",
                height: "420px",
                borderRadius: "32px",
                overflow: "hidden",
                border: "2px solid #0d1c33",
                backgroundColor: "#ffffff",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 18px 40px rgba(15, 27, 45, 0.18)",
              }}
            >
              <div
                style={{
                  height: "160px",
                  backgroundColor: "#0d1c33",
                  padding: "14px",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                {stars.map((star) => (
                  <div
                    key={star}
                    style={{
                      width: "22px",
                      height: "22px",
                      borderRadius: "999px",
                      backgroundColor: "#f8f5ef",
                      opacity: 0.85,
                    }}
                  />
                ))}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                {stripes.map((stripe, index) => (
                  <div
                    key={stripe}
                    style={{
                      flex: 1,
                      backgroundColor: index % 2 === 0 ? "#c7362c" : "#ffffff",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
