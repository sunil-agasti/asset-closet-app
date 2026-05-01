import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asset Closet",
  description: "Enterprise IT Asset Inventory Management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
