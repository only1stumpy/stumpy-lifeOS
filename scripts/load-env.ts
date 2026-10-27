import { config } from "dotenv";

// Match Next.js local development: .env.local takes precedence over .env.
config({ path: [".env.local", ".env"] });
