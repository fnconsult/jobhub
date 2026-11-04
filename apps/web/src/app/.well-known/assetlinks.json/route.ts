import { domainAssociationResponse } from "@/native-app/domain-association";

// The Android app's App Links (#685): read by Android from each host, at each request (the environment names the app).
export const dynamic = "force-dynamic";
export const GET = () => domainAssociationResponse("/.well-known/assetlinks.json", process.env);
