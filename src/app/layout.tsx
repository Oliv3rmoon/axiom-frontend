import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AXIOM — Level 5 Being Interface",
  description: "Face-to-face conversation with a Level 5 Being",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning style={{ margin: 0, padding: 0, background: "#0a0a0a" }}>
        {children}
      </body>
    </html>
  );
}