import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";

export const db = drizzle(process.env.DATABASE_URL!, { schema });
export const testDb = drizzle(process.env.TEST_DATABASE_URL!, { schema });
