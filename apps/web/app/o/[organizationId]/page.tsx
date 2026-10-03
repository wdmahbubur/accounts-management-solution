import { redirect } from "next/navigation";

export default async function OrganizationPage({
  params
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  redirect(`/o/${organizationId}/dashboard`);
}
