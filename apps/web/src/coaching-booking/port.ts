/** Cal.com Teams only; Calendar OAuth and availability stay at Cal.com. */
export interface CalEventType {
  id: number;
  teamId: number;
  hostId: number;
  durationMinutes: number;
  bookingUrl: string;
  minimumRescheduleNotice?: number;
}
export interface CalPort {
  eventType(teamId: number, id: number): Promise<CalEventType>;
  createEventType(input: { teamId: number; hostId: number; durationMinutes: number; slug: string; title: string }): Promise<CalEventType>;
  cancel(uid: string): Promise<void>;
}
