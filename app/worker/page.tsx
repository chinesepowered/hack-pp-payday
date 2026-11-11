import type { Metadata } from 'next';
import { WorkerApp } from './worker-app';

export const metadata: Metadata = { title: 'Worker app' };

export default function WorkerPage() {
  return <WorkerApp />;
}
