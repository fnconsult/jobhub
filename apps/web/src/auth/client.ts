"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient, inferAdditionalFields, magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { Auth } from "./index";

/**
 * Browser side of the Candidate-accounts module; talks to /api/auth on the same origin. Passkeys: add and rename (#664).
 * The sign-in email's code (#686): sign in with it.
 */
export const authClient = createAuthClient({ plugins: [magicLinkClient(), emailOTPClient(), passkeyClient(), inferAdditionalFields<Auth>()] });
