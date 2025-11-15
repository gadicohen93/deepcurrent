import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DeepCurrent - Self-Evolving Research OS',
  description: 'A research workspace with self-evolving agent strategies',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

