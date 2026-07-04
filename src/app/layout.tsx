import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Business Marketing Diagnostic",
  description: "A live, data-backed marketing checkup for any business.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
