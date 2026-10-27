import LifeOSRoot from "./lifeos-root";
export const dynamic = "force-dynamic";
export default function Home() {
  return <LifeOSRoot configured={Boolean(process.env.DATABASE_URL && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OWNER_ID)} />;
}

