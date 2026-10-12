import { notFound } from "next/navigation";
import Link from "next/link";
import { UiFixtures } from "./ui-fixtures.tsx";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function FixturePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.AMS_UI_TEST_HARNESS !== "1") notFound();
  const query = await searchParams;
  if (query.viewport === "1") {
    const candidate = typeof query.path === "string" ? query.path : "/companies";
    const path = /^\/(?:o\/[0-9a-f-]{36}(?:\/[a-z0-9/-]+)?|companies|onboarding\/company|settings\/(?:profile|security)|auth\/(?:sign-in|sign-up|recover|reset))?$/i.test(candidate) ? candidate : "/companies";
    const width = query.width === "768" ? 768 : query.width === "1366" ? 1366 : 390;
    return <main className="viewport-review">
      <header><h1>Responsive page review</h1><p>Actual application pages; sign-in and company permissions still apply.</p></header>
      <form method="get" className="panel toolbar">
        <input type="hidden" name="viewport" value="1" />
        <label>Page path<input name="path" defaultValue={path} /></label>
        <label>Viewport width<select name="width" defaultValue={String(width)}><option value="390">390 px</option><option value="768">768 px</option><option value="1366">1366 px</option></select></label>
        <button type="submit">Open page</button><Link href={path}>Open full page</Link>
      </form>
      <div className="viewport-review-scroll"><iframe title="Page preview" src={path} width={width} height={900} style={{ width, minWidth: width, background:"white", border:"1px solid var(--border)", borderRadius:8 }} /></div>
    </main>;
  }
  return <UiFixtures />;
}
