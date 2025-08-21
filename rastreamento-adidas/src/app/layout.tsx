import { Metadata } from "next";
import "./globals.css";
import 'leaflet/dist/leaflet.css';

export const metadata: Metadata = {
  title: "Rastreamento Adidas",
  description: "Sistema de rastreamento em tempo real",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
      </body>
    </html>
  );
}
