import {notFound} from 'next/navigation';
import {requireCoachSpaceV2} from '@/coach-space/server';
import {getCurrentCandidate} from '@/auth/server';
import {CoachSpaceShell} from '@/components/CoachSpaceHeader';
import {PushNotificationsForm} from '@/components/PushNotificationsForm';
import {pushEventsFor} from '@/push-notifications';
import {getPushNotifications} from '@/push-notifications/server';
import {CoachingNoticeSettings} from '@/coaching-notifications/Settings';
import {getCoachingNotifications,coachingNoticesOn} from '@/coaching-notifications/server';
const COACH="coach",PUSH_AUDIENCES=["human_coach"] as const;
export default async function Page(){await requireCoachSpaceV2();const person=await getCurrentCandidate();if(!person||!coachingNoticesOn())notFound();const push=getPushNotifications();return <CoachSpaceShell><CoachingNoticeSettings initial={await getCoachingNotifications().settings(person.id)} audience={COACH}/><PushNotificationsForm events={pushEventsFor(PUSH_AUDIENCES)} settings={await push.settings(person.id)} devices={(await push.devices(person.id)).length}/></CoachSpaceShell>;}
