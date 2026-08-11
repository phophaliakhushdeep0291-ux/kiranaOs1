import { writeFile } from "node:fs/promises";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const frame = JSON.parse(Buffer.concat(chunks).toString("utf8"));
await writeFile(process.argv[2], JSON.stringify(frame), "utf8");
