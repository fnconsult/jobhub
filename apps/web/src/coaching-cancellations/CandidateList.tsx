import {getHumanCoaches} from '@/human-coaches/server';
import {getCoachingCancellations,cancellationPolicyOn} from './server';
import {CancellationWindow} from './Window';
import {CancelAgendaItemButton} from '@/components/CancelAgendaItemButton';
import {getServerT} from '@/i18n/server';
import {Card} from '@/design/Card';
import {coachingTime} from '@jobhub/shared/coaching-time';
/** One of a list of things: an article (Card). */
const ARTICLE = "article";
export async function CandidateCancellationList({candidateId,locale,timeZone}:{candidateId:string;locale:'fr'|'en';timeZone:string}){
 if(!(await cancellationPolicyOn()))return null;
 const t=await getServerT(locale),sessions=await getHumanCoaches().sessions(candidateId),pending=new Set((await getCoachingCancellations().forCandidate(candidateId)).filter(c=>c.choice==='awaiting').map(c=>c.sessionId));
 return <section className="stack coaching-cancellations"><p>{t('coachingCancellation.notice')}</p>{sessions.filter(s=>!pending.has(s.id)).map(s=><Card as={ARTICLE} headingLevel={3} title={s.coach.name} key={s.id}>{s.scheduledAt?<p>{coachingTime(s.scheduledAt,locale,timeZone)}</p>:null}<CancellationWindow at={s.scheduledAt?.toISOString()??null}><CancelAgendaItemButton url={`/api/coaching/sessions/${s.id}/cancel`} label={t('coachingCancellation.refund')} name={t('agendaChanges.cancelSessionFor',{name:s.coach.name})} question={t('coachingCancellation.confirmationRefund')}/></CancellationWindow></Card>)}</section>;
}
