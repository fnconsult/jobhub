import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { CoachSpaceEmptyPage } from "@/coach-space/EmptyPage";
export default function Page() { requireCoachSpaceV2(); return CoachSpaceEmptyPage({ page: "aide" }); }
