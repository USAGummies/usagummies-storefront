export default function BoothDisplayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Bare layout — no AppShell nav/footer/popups. Just the display.
  return <>{children}</>;
}
