# A stopped or failed Job Search keeps its Job Offers; only a stop that kept none gives the Plan Quota back

A Job Search the Candidate stops, or that fails after finding Job Offers, keeps and links them (`job_offer_ids`), with its metrics and Provenance so far. Before, a failure dropped them. The Plan Quota use is given back for every failed search, and for a stopped one only when it kept no Job Offer: a stop that delivered results is a search that did its job.

A Stop request is applied by the worker, not by the web app: it polls `stopRequested` every second and aborts the run through a signal, so the run ends cleanly and records what it found. The web app only records the request.

## Considered Options

- **Give the quota back on every stop**: lets a Candidate keep the results of a full search and stop it just before the end for free.
- **Never give it back on a stop**: punishes a Candidate who stopped a search that found nothing.
- **Drop the Job Offers of a stopped search**: wastes pages already read and paid for.
- **Cancel a page read in flight**: more complexity for little gain; the read finishes and its offer is kept. Only AI calls are cancelled.
- **Do not give back a failed search that kept offers**: not changed here; the existing rule stays (a failure is not the Candidate's choice).

## Consequences

- With no worker running, a Stop request waits until a worker picks the search up; otherwise the 15-minute timeout fails it.
- Another Candidate's stop answers 403, which reveals that the search exists, whereas reading it answers 404.
