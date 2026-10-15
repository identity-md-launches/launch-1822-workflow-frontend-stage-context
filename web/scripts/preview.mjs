import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

export function preview(
  root = fileURLToPath(new URL("../../dist/", import.meta.url)),
) {
  const mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/preview/")) {
        res.writeHead(404).end();
        return;
      }
      const path = url.pathname.slice("/preview/".length) || "index.html";
      const file = resolve(root, decodeURIComponent(path));
      if (!file.startsWith(resolve(root) + "/")) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader(
        "Content-Type",
        mime[extname(file)] ?? "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-store");
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = preview();
  server.listen(4173, "0.0.0.0", () =>
    console.log("Static export at http://localhost:4173/preview/"),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit()));
}
