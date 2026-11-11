// Loads .env.local for scripts (Next.js loads it by itself for the app).
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
