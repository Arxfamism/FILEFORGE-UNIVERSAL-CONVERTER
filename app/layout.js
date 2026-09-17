import "./globals.css";

export const metadata = {
  title: "FileForge - Universal Converter",
  description: "Privacy-first in-browser file converter",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FileForge",
  },
};

export const viewport = {
  themeColor: "#0070f3",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>{children}</body>
    </html>
  );
}
