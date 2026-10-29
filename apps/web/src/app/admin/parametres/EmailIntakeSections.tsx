import { BackOfficeForm } from "@/components/BackOfficeForm";
import { ExplainableLabel } from "@/components/ExplainableLabel";
import type { ListedRecognisedSender, ProposedSender } from "@/email-intake/recognised-sender-list";
import { MAX_SENDER_LABEL_LENGTH } from "@/email-intake/recognised-sender-list";
import { addRecognisedSender, relabelRecognisedSender, removeRecognisedSender, setRecognisedSender } from "./actions";
import { buttonClass } from "@/design/button-class";
import { TextInput } from "@/design/Field";
import { Table } from "@/design/Table";
import { Here, type Ctx } from "./context";
import { tabNameOf } from "./SettingName";

/** What the sheet's Explainable labels are (#407): the lists' intros, and each sender. */
const EXPLAINED = { intro: "intro", sender: "recognised_sender", senders: "recognised_senders", proposed: "proposed_senders" } as const;

/** The form fields of a Recognised sender's actions. */
export const SENDER_FIELDS = { sender: "sender", label: "label", enabled: "enabled" } as const;

/** What the Email intake sheet lists below its keys and settings (#448). */
export interface EmailIntakeLists {
  senders: readonly ListedRecognisedSender[];
  proposed: readonly ProposedSender[];
}

/** One button sending `sender` (and `enabled`) to `action`; disabled, with nothing to send, for roles that may only read. */
function SenderButton({ ctx, action, sender, enabled, children }: { ctx: Ctx; action: (form: FormData) => Promise<void>; sender: string; enabled?: boolean; children: string }) {
  return (
    <BackOfficeForm canWrite={ctx.can.sites} action={action}>
      <Here ctx={ctx} />
      <input type="hidden" name={SENDER_FIELDS.sender} value={sender} />
      {enabled === undefined ? null : <input type="hidden" name={SENDER_FIELDS.enabled} value={String(enabled)} />}
      <button className={buttonClass()} type="submit" disabled={!ctx.can.sites}>
        {children}
      </button>
    </BackOfficeForm>
  );
}

/** A field id for `sender`, safe in HTML whatever it holds. */
const fieldId = (prefix: string, sender: string) => `${prefix}-${sender.replace(/[^a-z0-9]+/gi, "-")}`;

/**
 * The Email intake sheet's lists (#448): the platform's Recognised senders, each enabled or not with its label, added,
 * relabelled, disabled and removed by those who change the Job discovery sources; then « Expéditeurs proposés », the
 * senders Candidates added for themselves, counted with no name, accepted with a label. Support reads, changes nothing.
 */
export function EmailIntakeSections({ ctx, lists }: { ctx: Ctx; lists: EmailIntakeLists }) {
  const { t } = ctx;
  const tab = tabNameOf(ctx);
  const date = new Intl.DateTimeFormat(ctx.locale, { dateStyle: "medium", timeZone: "Europe/Paris" });
  const status = (enabled: boolean) => t(enabled ? "admin.searchSites.enabled" : "admin.searchSites.disabled");

  return (
    <>
      <section className="stack" aria-labelledby="sheet-senders" data-section="recognised-senders">
        <h3 id="sheet-senders">
          <ExplainableLabel item={{ kind: EXPLAINED.intro, id: EXPLAINED.senders, tab, value: String(lists.senders.length) }}>{t("admin.emailIntake.senders.title")}</ExplainableLabel>
        </h3>
        <p>{t("admin.emailIntake.senders.intro")}</p>
        {lists.senders.length === 0 ? (
          <p>{t("admin.emailIntake.senders.none")}</p>
        ) : (
          <Table
            label={t("admin.emailIntake.senders.caption")}
            columns={[
              {
                header: t("admin.emailIntake.senders.sender"),
                rowHeader: true,
                cell: (sender) => (
                  <>
                    <ExplainableLabel
                      item={{
                        kind: EXPLAINED.sender,
                        id: sender.value,
                        tab,
                        value: sender.label,
                        source: t("admin.emailIntake.senders.platformList"),
                        state: `${t(`admin.emailIntake.senders.matches.${sender.match}`)} ; ${status(sender.enabled)}`,
                      }}
                      code
                    >
                      {sender.value}
                    </ExplainableLabel>
                    <br />
                    {t(`admin.emailIntake.senders.matches.${sender.match}`)}
                  </>
                ),
              },
              { header: t("admin.emailIntake.senders.label"), cell: (sender) => sender.label },
              { header: t("admin.emailIntake.senders.status"), cell: (sender) => status(sender.enabled) },
              {
                header: t("admin.emailIntake.senders.actions"),
                cell: (sender) => (
                  <div className="stack">
                    <SenderButton ctx={ctx} action={setRecognisedSender} sender={sender.value} enabled={!sender.enabled}>
                      {t(sender.enabled ? "admin.emailIntake.senders.disable" : "admin.emailIntake.senders.enable", { sender: sender.value })}
                    </SenderButton>
                    {ctx.can.sites ? (
                      <details>
                        <summary>{t("admin.emailIntake.senders.relabel", { sender: sender.value })}</summary>
                        <form className="stack" action={relabelRecognisedSender}>
                          <Here ctx={ctx} />
                          <input type="hidden" name={SENDER_FIELDS.sender} value={sender.value} />
                          <label htmlFor={fieldId("relabel", sender.value)}>{t("admin.emailIntake.senders.newLabel", { sender: sender.value })}</label>
                          <TextInput id={fieldId("relabel", sender.value)} name={SENDER_FIELDS.label} defaultValue={sender.label} required maxLength={MAX_SENDER_LABEL_LENGTH} />
                          <button className={buttonClass()} type="submit">
                            {t("admin.emailIntake.senders.saveLabel", { sender: sender.value })}
                          </button>
                        </form>
                      </details>
                    ) : null}
                    <SenderButton ctx={ctx} action={removeRecognisedSender} sender={sender.value}>
                      {t("admin.emailIntake.senders.remove", { sender: sender.value })}
                    </SenderButton>
                  </div>
                ),
              },
            ]}
            rows={lists.senders}
            rowKey={(sender) => sender.value}
            rowAttributes={(sender) => ({ "data-sender": sender.value })}
          />
        )}
        <BackOfficeForm canWrite={ctx.can.sites} action={addRecognisedSender} className="stack parametres-form">
          <Here ctx={ctx} />
          <fieldset disabled={!ctx.can.sites}>
            <legend>{t("admin.emailIntake.senders.addTitle")}</legend>
            <div className="stack">
              <label htmlFor="recognised-sender">{t("admin.emailIntake.senders.senderField")}</label>
              <TextInput id="recognised-sender" name={SENDER_FIELDS.sender} required spellCheck={false} autoComplete="off" aria-describedby="recognised-sender-help" />
              <p id="recognised-sender-help">{t("admin.emailIntake.senders.senderHelp")}</p>
            </div>
            <div className="stack">
              <label htmlFor="recognised-sender-label">{t("admin.emailIntake.senders.labelField")}</label>
              <TextInput id="recognised-sender-label" name={SENDER_FIELDS.label} required maxLength={MAX_SENDER_LABEL_LENGTH} aria-describedby="recognised-sender-label-help" />
              <p id="recognised-sender-label-help">{t("admin.emailIntake.senders.labelHelp")}</p>
            </div>
            <button className={buttonClass({ variant: "primary" })} type="submit">
              {t("admin.emailIntake.senders.add")}
            </button>
          </fieldset>
        </BackOfficeForm>
      </section>

      <section className="stack" aria-labelledby="sheet-proposed" data-section="proposed-senders">
        <h3 id="sheet-proposed">
          <ExplainableLabel item={{ kind: EXPLAINED.intro, id: EXPLAINED.proposed, tab, value: String(lists.proposed.length) }}>{t("admin.emailIntake.proposed.title")}</ExplainableLabel>
        </h3>
        <p>{t("admin.emailIntake.proposed.intro")}</p>
        {lists.proposed.length === 0 ? (
          <p>{t("admin.emailIntake.proposed.none")}</p>
        ) : (
          <Table
            label={t("admin.emailIntake.proposed.caption")}
            columns={[
              {
                header: t("admin.emailIntake.senders.sender"),
                rowHeader: true,
                cell: (proposal) => (
                  <ExplainableLabel
                    item={{
                      kind: EXPLAINED.sender,
                      id: proposal.value,
                      tab,
                      source: t("admin.emailIntake.proposed.title"),
                      state: `${t(`admin.emailIntake.senders.matches.${proposal.match}`)} ; ${t("admin.emailIntake.proposed.proposedBy", { count: proposal.candidates })}`,
                    }}
                    code
                  >
                    {proposal.value}
                  </ExplainableLabel>
                ),
              },
              { header: t("admin.emailIntake.proposed.candidates"), cell: (proposal) => proposal.candidates },
              { header: t("admin.emailIntake.proposed.lastAdded"), cell: (proposal) => <time dateTime={proposal.lastAddedAt.toISOString()}>{date.format(proposal.lastAddedAt)}</time> },
              {
                header: t("admin.emailIntake.senders.actions"),
                cell: (proposal) => (
                  <BackOfficeForm canWrite={ctx.can.sites} action={addRecognisedSender} className="stack">
                    <Here ctx={ctx} />
                    <input type="hidden" name={SENDER_FIELDS.sender} value={proposal.value} />
                    <label htmlFor={fieldId("accept", proposal.value)}>{t("admin.emailIntake.proposed.labelFor", { sender: proposal.value })}</label>
                    <TextInput id={fieldId("accept", proposal.value)} name={SENDER_FIELDS.label} required maxLength={MAX_SENDER_LABEL_LENGTH} disabled={!ctx.can.sites} />
                    <button className={buttonClass()} type="submit" disabled={!ctx.can.sites}>
                      {t("admin.emailIntake.proposed.accept", { sender: proposal.value })}
                    </button>
                  </BackOfficeForm>
                ),
              },
            ]}
            rows={lists.proposed}
            rowKey={(proposal) => proposal.value}
            rowAttributes={(proposal) => ({ "data-proposed": proposal.value })}
          />
        )}
      </section>
    </>
  );
}
