// The 戰報 Durable Object as Wrangler builds it: the logic of report-core.js with
// the two storyteller prompts, which are Text modules (the `rules` entry for
// **/*.md in wrangler.jsonc). Node cannot import this file; tests load
// report-core.js and pass prompts of their own.
import { ReportCore } from "./report-core.js";
import zh from "./report-skill/zh.md";
import en from "./report-skill/en.md";

export class Report extends ReportCore {
  constructor(ctx, env) { super(ctx, env, { zh, en }); }
}
