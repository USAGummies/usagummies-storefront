export function Footer() {
  return (
    <footer
      style={{
        padding: "2rem",
        textAlign: "center",
        borderTop: "1px solid #e5e5e5",
        marginTop: "4rem",
        fontSize: "0.9rem",
      }}
    >
      © {new Date().getFullYear()} USA Gummies. All rights reserved.
    </footer>
  );
}
