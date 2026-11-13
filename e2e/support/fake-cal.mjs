// E2E ONLY, deliberate preload outside the shipped bundle. No legal wording or approval.
const coverage=globalThis[Symbol.for("jobbbox.e2e.coaching-legal")];
if(coverage)for(const version of coverage)version.coachingCapabilities.push("cal-com");
globalThis[Symbol.for("jobbbox.e2e.cal-legal")]={recipients:["cal-com"],firstSeen:"2026-01-01T00:00:00Z"};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
 if(url.origin==="https://api.cal.com"&&process.env.E2E_CAL_URL){url.protocol="http:";const target=new URL(process.env.E2E_CAL_URL);url.host=target.host;return originalFetch(url,init);}
 return originalFetch(input,init);
};
