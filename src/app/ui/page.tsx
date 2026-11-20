import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isGalleryEnabled } from "@/components/ui/gallery-access";
import { UiGallery } from "@/components/ui/gallery";

export const metadata: Metadata = { title: "UI-кит", robots: { index: false, follow: false } };

export default function UiGalleryPage() {
  if (!isGalleryEnabled()) notFound();
  return <UiGallery />;
}
