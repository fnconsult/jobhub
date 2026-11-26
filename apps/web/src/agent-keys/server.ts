import { sharedPool } from "@/database/pool";
import { createAgentKeys, type AgentKeys } from "./index";

let instance: AgentKeys | undefined;

/** The app's Agent Keys (#1139), on the database named by DATABASE_URL. */
export function getAgentKeys(): AgentKeys {
  instance ??= createAgentKeys(sharedPool());
  return instance;
}
