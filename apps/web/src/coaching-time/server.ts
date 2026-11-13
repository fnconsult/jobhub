import { sharedPool } from "@/database/pool";
import { coachingTimeZones } from "./index";
export const getCoachingTimeZones = () => coachingTimeZones(sharedPool());
