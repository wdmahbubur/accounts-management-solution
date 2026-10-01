import { notFound } from "next/navigation";
import { UiFixtures } from "./ui-fixtures.tsx";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default function FixturePage() {
  if (process.env.AMS_UI_TEST_HARNESS !== "1") notFound();
  return <UiFixtures />;
}
