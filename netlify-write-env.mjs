import fs from "fs";

const url = process.env.SUPABASE_URL || "";
const anon = process.env.SUPABASE_ANON_KEY || "";

const content = `// Auto-generated at deploy time.\nwindow.__ENV = ${JSON.stringify({SUPABASE_URL:url, SUPABASE_ANON_KEY:anon})};\n`;

fs.writeFileSync("./env.generated.js", content, "utf8");
console.log("Wrote env.generated.js");
