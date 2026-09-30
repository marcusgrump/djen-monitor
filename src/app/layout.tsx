import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "DJEN Monitor",
    template: "%s · DJEN Monitor",
  },
  description:
    "Painel do DJEN Monitor: acompanhe comunicações processuais do Diário de Justiça Eletrônico Nacional (CNJ).",
  applicationName: "DJEN Monitor",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a243b",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
