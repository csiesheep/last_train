// A stand-in for the model, for local runs of the 戰報: answers every call with
// a plain story of the right shape (one chapter per stop). Start it, then put
//   DEEPSEEK_BASE_URL=http://127.0.0.1:8788
//   DEEPSEEK_API_KEY=stub
// in .dev.vars and run `wrangler dev`. Never deployed.
import { createServer } from "node:http";
const PORT = +(process.env.PORT || 8788);
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { messages } = JSON.parse(body || "{}");
    const user = (messages || []).find((m) => m.role === "user")?.content || "";
    const zh = /LANG: zh/.test(user);
    const stops = +(user.match(/STOPS: (\d+)/) || [0, 1])[1];
    const story = {
      title: zh ? "末班夜車演義" : "The Tale of the Last Night Train",
      intro: zh ? "話說這一夜的末班車，三等車廂坐了幾位素不相識的客人。" : "It was the last train of the night, and the third-class carriage held strangers.",
      chapters: Array.from({ length: stops }, (_, i) => ({
        stop: i + 1,
        heading: zh ? "夜車出站人未識　燈影搖晃各藏心" : "The train pulls out; the lamps sway",
        items: [], caption: zh ? "車廂裡暗潮洶湧。" : "The carriage held its breath.",
        paragraphs: zh ? ["車過一站，燈影搖晃，誰也不先開口。", "有人低聲說了一句話，旁邊的人假裝沒聽見。"] : ["Another stop went by; the lamps swayed and nobody spoke first.", "Someone whispered; the rest pretended not to hear."],
      })),
      ending: zh ? "終點到了，汽笛一聲，各人提著行李下車。" : "The end of the line: a whistle, and everyone stepped down with their bags.",
      poem: zh ? "夜車不問來時路\n箱底各藏玉與錶\n燈滅燈明人相認\n一聲汽笛見分曉" : "The night train asks not whence you came\nEach case hides jade or ticking gold\nThe lamps go dark, the lamps return\nOne whistle, and the tale is told",
    };
    const seats = (user.match(/^- \[(\d+)\]/gm) || []).length;
    story.clues = Array.from({ length: seats }, (_, seat) => ({ seat, stop: 1, text: zh ? "第一站就露了底。" : "The first stop gave them away." }));
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(story) }, finish_reason: "stop" }], usage: {} }));
    }, +(process.env.DELAY || 2500));
  });
}).listen(PORT, "127.0.0.1", () => console.log("deepseek stub on " + PORT));
