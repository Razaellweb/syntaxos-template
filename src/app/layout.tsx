import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SyntaxOS App",
  description: "Built with the SyntaxOS template",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
