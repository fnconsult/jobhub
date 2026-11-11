import {NextResponse} from 'next/server';
import {getCurrentCandidate,isFromTrustedOrigin} from '@/auth/server';
import {getCoachingNotifications,coachingNoticesOn} from '@/coaching-notifications/server';
export async function PUT(request:Request){
 if(!isFromTrustedOrigin(request))return NextResponse.json({error:'forbidden'},{status:403});const person=await getCurrentCandidate();if(!person)return NextResponse.json({error:'unauthorized'},{status:401});if(!coachingNoticesOn())return NextResponse.json({error:'unavailable'},{status:409});
 const saved=await getCoachingNotifications().updateSettings(person.id,await request.json().catch(()=>null));return NextResponse.json({saved},{status:saved?200:400});
}
