import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const root = resolve("out");
const types = { ".css": "text/css", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".webp": "image/webp", ".woff2": "font/woff2" };

await stat(join(root, "index.html"));

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const candidate = resolve(join(root, pathname === "/" ? "index.html" : pathname.slice(1)));
    if (candidate !== root && !candidate.startsWith(root + sep)) throw new Error("Invalid path");
    const file = (await stat(candidate)).isDirectory() ? join(candidate, "index.html") : candidate;
    const contents = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    response.end(contents);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(3000, "127.0.0.1", () => console.log("TaskFlow E2E static server ready on 127.0.0.1:3000"));
