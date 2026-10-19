import { ProfileSectionPage, loadProfilePage } from "./profile-page";

/** Always there, should the Profile have no Section before it. */
const FIRST = "cv-de-reference";

/** A Profile's page itself shows its first Section (on phones, the list of its Sections). */
export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sections } = await loadProfilePage(id);
  return <ProfileSectionPage id={id} section={sections[0] ?? FIRST} />;
}
