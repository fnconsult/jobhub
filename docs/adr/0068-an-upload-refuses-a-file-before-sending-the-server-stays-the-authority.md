# An upload refuses a file before sending; the server stays the authority

Status: accepted (#468)

The File upload checks the chosen file's size (10 MB, `cv/limits.ts`) and format as soon as it is chosen, so the Candidate learns at once instead of after a long send.

- The browser's check is a courtesy: the server checks again and its answer wins.
- The limit lives in one file both sides import.
- A dropped file is put into the form's file input, so the form sends it like a picked one.

Alternative not taken: checking only on the server (a slow, late refusal).
