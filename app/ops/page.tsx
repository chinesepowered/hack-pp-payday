import type { Metadata } from 'next';
import { OpsDesk } from './ops-desk';

export const metadata: Metadata = { title: 'Payouts desk' };

export default function OpsPage() {
  return <OpsDesk />;
}
