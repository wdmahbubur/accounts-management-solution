import { RoleScreen } from "../role-screen.tsx";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function Page({ params }: { params: Promise<{ organizationId: string }> }) {
  return <RoleScreen organizationId={(await params).organizationId} view="roles" />;
}
