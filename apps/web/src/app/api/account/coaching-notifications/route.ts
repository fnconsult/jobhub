// « Espace coach v2 » (ADR-0107): a 404 while it is off, as before the Human Coach epic.
import { coachSpaceV2On } from "@/coach-space-v2/server";
import {NextResponse} from 'next/server';
import {getCurrentCandidate,isFromTrustedOrigin} from '@/auth/server';
import {getCoachingNotifications,coachingNoticesOn} from '@/coaching-notifications/server';
export async function PUT(request:Request){
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
 if(!isFromTrustedOrigin(request))return NextResponse.json({error:'forbidden'},{status:403});const person=await getCurrentCandidate();if(!person)return NextResponse.json({error:'unauthorized'},{status:401});if(!coachingNoticesOn())return NextResponse.json({error:'unavailable'},{status:409});
 const saved=await getCoachingNotifications().updateSettings(person.id,await request.json().catch(()=>null));return NextResponse.json({saved},{status:saved?200:400});
}
