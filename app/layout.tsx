import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppLayout } from "@/components/layout/app-layout";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "今天吃了吗 - 随机菜单",
  description: "随机决定今天吃什么，菜谱与外卖一网打尽",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <AppLayout>{children}</AppLayout>
        </ThemeProvider>
      </body>
    </html>
  );
}
