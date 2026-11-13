import { sharedPool } from "@/database/pool";
import { coachContacts } from "./contacts";
export const getCoachContacts = () => coachContacts(sharedPool());
