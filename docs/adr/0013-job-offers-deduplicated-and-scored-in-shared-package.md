# Job Offers are deduplicated on capture and the Match Score is computed in the shared package

A captured Job Offer is deduplicated by its normalised source URL (ignoring "www", trailing slash, fragment and tracking parameters) or by a fingerprint of its content (ignoring case and spacing). Capturing a posting again returns the Job Offer stored first and ignores the new content, so one Job Offer can be referenced by many Candidates and Guests without copies.

The Match Score is a pure function (`scoreMatch`) in the shared package, with fixed rules rather than an AI task, so the extension's Guest flow and the web app score identically and a CV can be scored without being stored (ADR-0003).
