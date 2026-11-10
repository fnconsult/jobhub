import { sharedPool } from "@/database/pool";
import { coachEarnings } from "./index";
export const getCoachEarnings = () => coachEarnings(sharedPool());
