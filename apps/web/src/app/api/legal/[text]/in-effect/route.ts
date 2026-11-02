import { parisDay } from "@jobhub/help";
import { NextResponse } from "next/server";
import { legalTextInEffect } from "@/public-pages/legal-in-effect";

type Params = { params: Promise<{ text: string }> };

/**
 * The version of a Legal Text in effect today in France (#550): `{ version, url }`, or `{ version: null }` while none
 * is. Public and the same for everyone: the extension reads the CGU's to show the Guest's box, and sends nothing back.
 * 404 for a text that does not exist.
 */
export async function GET(_request: Request, { params }: Params) {
  const reply = legalTextInEffect((await params).text, parisDay());
  if (!reply) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(reply, { headers: { "cache-control": "no-store" } });
}
