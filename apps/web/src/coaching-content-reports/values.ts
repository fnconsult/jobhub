export const REPORT_REASONS = ["illegal", "misleading", "discrimination", "child_abuse", "other"] as const;
export const REPORT_OUTCOMES = ["remove", "suspend", "keep"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];
