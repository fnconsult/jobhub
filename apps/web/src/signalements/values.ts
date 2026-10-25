/**
 * The values a Signalement can hold, and its limits (#283): the ONLY list of each. Whatever reads or checks them (the
 * sending route, the table's CHECK constraints, the Back Office's filters and buttons, the Candidate's list) imports
 * them from here. They are written in the database: renaming one means rewriting its rows. They are not wordings;
 * each screen words them through i18n.
 *
 * Depends on nothing, on purpose: a page or a route can import it without pulling in the database.
 */

/** A Bug, an Idée, or a Question to the team after help that did not satisfy the Candidate (#281). */
export const SIGNALEMENT_TYPES = ["bug", "idee", "question"] as const;
export type SignalementType = (typeof SIGNALEMENT_TYPES)[number];
export const isSignalementType = (value: unknown): value is SignalementType => (SIGNALEMENT_TYPES as readonly unknown[]).includes(value);

/** Where a Signalement stands, in the order of its life. */
export const SIGNALEMENT_STATUSES = ["nouveau", "vu", "traite"] as const;
export type SignalementStatus = (typeof SIGNALEMENT_STATUSES)[number];
/** « À traiter »: what the team still has to handle, what the Back Office lists by default and counts (#376). */
export const TO_HANDLE_STATUSES = ["nouveau", "vu"] as const satisfies readonly SignalementStatus[];

export const isSignalementStatus = (value: unknown): value is SignalementStatus => (SIGNALEMENT_STATUSES as readonly unknown[]).includes(value);

/** The message's length, in characters, once trimmed. */
export const MESSAGE_MIN_LENGTH = 10;
export const MESSAGE_MAX_LENGTH = 2_000;
/** The team's reply's length, in characters, once trimmed. */
export const REPLY_MAX_LENGTH = 2_000;
/** The question and the coach reply a Question carries, each, in characters. */
export const ATTACHED_MAX_LENGTH = 10_000;

/** How many Signalements a Candidate may send in a rolling SENDING_WINDOW_HOURS. */
export const SENDING_LIMIT = 10;
export const SENDING_WINDOW_HOURS = 24;

/** How long a Signalement is kept once marked `traite`; one not yet handled is kept until it is. */
export const RETENTION_MONTHS = 12;
