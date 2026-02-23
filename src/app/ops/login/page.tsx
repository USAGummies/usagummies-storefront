import { Suspense } from "react";
import { LoginForm } from "./LoginForm.client";

export default function OpsLoginPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0f1117",
            color: "rgba(255,255,255,0.4)",
            fontSize: 14,
          }}
        >
          Loading...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
