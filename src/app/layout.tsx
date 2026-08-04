import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Cat Games",
  description:
    "Research-informed hunting games for cats, built for the iPad. Catchable prey, sessions that end, and no red.",
  appleWebApp: {
    capable: true,
    title: "Cat Games",
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#07090d",
  // Locked down so a paw dragging across the glass can't zoom the page or
  // scroll the game out from under itself.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col overscroll-none bg-[#07090d] font-sans">
        {children}
      </body>
    </html>
  );
}
