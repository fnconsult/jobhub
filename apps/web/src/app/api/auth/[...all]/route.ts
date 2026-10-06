import { getAuth } from "@/auth/server";

// Every Candidate-account endpoint: magic link, Google, session, settings, sign-out.
export const GET = (request: Request) => getAuth().handler(request);
export const POST = (request: Request) => getAuth().handler(request);
