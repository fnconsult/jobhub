/** A database guard covers every legacy writer, including native and Coach Actions. */
export function linkedBookingConflict(error: unknown) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23514" &&
    "message" in error &&
    error.message === "Use Cal.com for a linked booking"
  );
}
