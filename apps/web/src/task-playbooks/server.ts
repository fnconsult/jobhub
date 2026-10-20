import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import type { TaskPlaybookReader } from "./index";

/** The app's task Playbooks: each read at the version this environment serves (JOBHUB_TARGET, ADR-0026). */
export const getTaskPlaybooks = (): TaskPlaybookReader => (id) => getCoachingPlaybooks().servedTask(id);
