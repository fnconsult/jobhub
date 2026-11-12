import { afterEach,describe,expect,it,vi } from "vitest";
import { fetchConversation } from "./chat-conversation";

describe("a signed Human Coach report reopened in the browser",()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it("preserves its author through the saved-conversation transport, so it is never labelled as AI",async()=>{
    const author={id:"coach-id",name:"Sophie Martin",photoUrl:null};
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({conversation:{id:"conversation-id",title:"Session",aiDisclosure:true,messages:[{from:"coach",text:"Our report",humanCoach:author,at:"2026-11-10T15:00:00Z"}]}})));
    const loaded=await fetchConversation("/api/coach/conversations","conversation-id");
    expect("conversation" in loaded&&loaded.conversation.messages[0]).toMatchObject({from:"coach",text:"Our report",humanCoach:author});
  });
});
