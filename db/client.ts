import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// HTTP-based (fetch), not pooled TCP: fits Vercel serverless functions without
// risking connection exhaustion across concurrent invocations.
const sql = neon(process.env.DATABASE_URL!);

export const db = drizzle(sql, { schema });
