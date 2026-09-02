import assert from "node:assert/strict";
import { groundAgentReply } from "../src/modules/ai/agent/agent.service.js";

const unsupported = groundAgentReply({
  reply: "Today you sold ₹99,999 and Sugar is out of stock.",
  plan: [],
  trace: [],
  language: "en",
});
assert.equal(unsupported.providerReplyAccepted, false);
assert.equal(unsupported.grounding, "no_verified_evidence");
assert.doesNotMatch(unsupported.reply, /99,999|Sugar|out of stock/);
assert.match(unsupported.reply, /could not verify/i);

const falseCompletion = groundAgentReply({
  reply: "Done, I changed Sugar to ₹45.",
  plan: [{ ref: "1", tool: "set_price", risk: "owner_pin" }],
  trace: [{ tool: "set_price", kind: "write", status: "proposed" }],
  language: "en",
});
assert.equal(falseCompletion.providerReplyAccepted, false);
assert.equal(falseCompletion.grounding, "server_composed_proposal");
assert.doesNotMatch(falseCompletion.reply, /Done|changed Sugar/i);
assert.match(falseCompletion.reply, /Nothing has changed yet/i);

const evidenced = groundAgentReply({
  reply: "The sales summary reports ₹1,200 today.",
  plan: [],
  trace: [{ tool: "sales_summary", kind: "read", status: "ok" }],
  language: "en",
});
assert.equal(evidenced.providerReplyAccepted, true);
assert.equal(evidenced.grounding, "verified_tool_reads");
assert.equal(evidenced.evidenceReads, 1);
assert.match(evidenced.reply, /₹1,200/);

const hindi = groundAgentReply({ reply: "invented", plan: [], trace: [], language: "hi" });
assert.equal(hindi.providerReplyAccepted, false);
assert.match(hindi.reply, /पुष्टि नहीं कर सका/);

console.log("AI agent response grounding examples passed");

