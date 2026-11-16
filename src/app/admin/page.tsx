import type { Metadata } from "next";
import AdminApp from "./admin-app";

export const metadata: Metadata = { title: "LifeOS · админ-панель", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminApp />;
}
