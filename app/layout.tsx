import type { Metadata, Viewport } from 'next';
import { Chrome } from '@/components/chrome';
import './globals.css';

export const metadata: Metadata = {
  title: { template: '%s | Payday', default: 'Payday: same-day pay for gig workers' },
  description:
    'Payday pays gig workers the moment a job is verified, through PayPal Payouts, and an AI watchdog catches payout mistakes before they cost money.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f766e' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Chrome />
        <main id="main" className="flex min-h-0 flex-1 flex-col">
          {children}
        </main>
      </body>
    </html>
  );
}
