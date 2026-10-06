"use client";

import { inferAdditionalFields, magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { Auth } from "./index";

/** Browser side of the Candidate-accounts module; talks to /api/auth on the same origin. */
export const authClient = createAuthClient({ plugins: [magicLinkClient(), inferAdditionalFields<Auth>()] });
