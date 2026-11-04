import { domainAssociationResponse } from "@/native-app/domain-association";

// The iOS app's universal links (#685): read by Apple from each host, at each request (the environment names the app).
export const dynamic = "force-dynamic";
export const GET = () => domainAssociationResponse("/.well-known/apple-app-site-association", process.env);
