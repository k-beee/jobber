import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Jobber | Decentralized Freelance Escrow & AI Arbitration",
  description: "Secure, trustless freelance agreement escrow with robust AI-powered dispute resolution, built on GenLayer.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="mesh-bg"></div>
        {children}
      </body>
    </html>
  );
}
