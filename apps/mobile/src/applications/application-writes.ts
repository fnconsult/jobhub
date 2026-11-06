import type { ApplicationStatus } from "@jobhub/shared";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useApi } from "../api/api";
import { readKey } from "../offline/read-cache";
import { interviewBody, type InterviewDraft } from "./interview-draft";

/** A field the web app refused, as its Applications module names it (`{ field, code }`). */
export type FieldError = { field: string; code: string };

/**
 * What a write came to: saved; refused by the web app, field by field (400); or `failed`, not saved for any other
 * reason (no network, the web app unreachable or failing, a 404, a 409 such as an Interview added off « Entretien »).
 */
export type WriteOutcome = { ok: true } | { ok: false; errors: FieldError[] } | { ok: false; failed: true };

const FAILED: WriteOutcome = { ok: false, failed: true };

/**
 * The changes the app makes to one of the Candidate's Applications (#691), through the web's own routes and rules
 * (apps/web/src/app/api/applications, ADR-0076): its status, and its Interviews added, changed (a new date is a
 * Reschedule), Cancelled or removed. Never sent without network (ADR-0076, #701): `failed` at once. Once the web app has
 * saved one, the reads it changes are read again (the Application, Mes candidatures, the Agenda) before it resolves, so
 * every screen shows what the web app now holds.
 */
export function useApplicationWrites(applicationId: string) {
  const api = useApi();
  const queries = useQueryClient();
  return useMemo(() => {
    const base = `/api/applications/${encodeURIComponent(applicationId)}`;
    const interview = (id: string) => `${base}/interviews/${encodeURIComponent(id)}`;

    async function write(path: string, method: "POST" | "PATCH" | "DELETE", body?: object): Promise<WriteOutcome> {
      if (!onlineManager.isOnline()) return FAILED;
      let response: Response;
      try {
        response = await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      } catch {
        return FAILED;
      }
      if (!response.ok) {
        const answer = (await response.json().catch(() => ({}))) as { errors?: unknown };
        return response.status === 400 && Array.isArray(answer.errors) ? { ok: false, errors: answer.errors as FieldError[] } : FAILED;
      }
      await Promise.all([
        queries.invalidateQueries({ queryKey: readKey("application", applicationId) }),
        queries.invalidateQueries({ queryKey: readKey("applications") }),
        queries.invalidateQueries({ queryKey: readKey("agenda") }),
      ]);
      return { ok: true };
    }

    return {
      /** The Application Status, changed by hand (`PATCH /api/applications/:id`). */
      changeStatus: (status: ApplicationStatus) => write(base, "PATCH", { status }),
      /** A dated Interview added, only while the Application is at « Entretien » (`POST …/interviews`). */
      addInterview: (draft: InterviewDraft) => write(`${base}/interviews`, "POST", interviewBody(draft)),
      /** An Interview's fields replaced by the draft's; a new date is a Reschedule (`PATCH …/interviews/:id`). */
      changeInterview: (id: string, draft: InterviewDraft) => write(interview(id), "PATCH", interviewBody(draft)),
      /** An Interview Cancelled: it stays, struck through, with its date of cancellation (`POST …/interviews/:id/cancel`). */
      cancelInterview: (id: string) => write(`${interview(id)}/cancel`, "POST"),
      /** An Interview entered by mistake, removed without a trace (`DELETE …/interviews/:id`). */
      removeInterview: (id: string) => write(interview(id), "DELETE"),
    };
  }, [api, queries, applicationId]);
}

export type ApplicationWrites = ReturnType<typeof useApplicationWrites>;
