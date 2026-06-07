import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createRealtimeSessionHandler } from "../../packages/server/src/index";
import { defineConfig, type Plugin } from "vite";

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = resolve(CONFIG_DIR, "../..");

function realtimeTokenPlugin(): Plugin {
  return {
    name: "demo-realtime-token",
    configureServer(server) {
      server.middlewares.use("/api/realtime-token", async (req, res) => {
        const apiKey = readApiKey();

        if (!apiKey) {
          writeResponse(
            res,
            new Response(
              JSON.stringify({
                error:
                  "OPENAI_API_KEY is not set. Add it to .env.local or apps/demo/.env.local.",
              }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
          return;
        }

        const handler = createRealtimeSessionHandler({
          apiKey,
          getSafetyIdentifier: () => "realtime-speech-demo",
        });
        const request = await toRequest(req);
        const response = await handler(request);
        await writeResponse(res, response);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), realtimeTokenPlugin()],
  resolve: {
    alias: {
      "@realtime-speech/core": resolve(WORKSPACE_DIR, "packages/core/src/index.ts"),
      "@realtime-speech/react": resolve(WORKSPACE_DIR, "packages/react/src/index.ts"),
      "@realtime-speech/server": resolve(WORKSPACE_DIR, "packages/server/src/index.ts"),
    },
  },
  server: {
    port: 5174,
  },
});

async function toRequest(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new Request(`http://localhost${req.url ?? "/"}`, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
  });
}

async function writeResponse(
  res: import("node:http").ServerResponse,
  response: Response,
) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}

function readApiKey() {
  for (const path of [
    join(CONFIG_DIR, ".env.local"),
    join(CONFIG_DIR, ".env"),
    join(WORKSPACE_DIR, ".env.local"),
    join(WORKSPACE_DIR, ".env"),
  ]) {
    const value = readEnvFileValue(path, "OPENAI_API_KEY");

    if (value) {
      return value;
    }
  }

  return process.env.OPENAI_API_KEY;
}

function readEnvFileValue(path: string, key: string) {
  let text: string;

  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);

    if (match?.[1] === key) {
      return match[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }

  return undefined;
}
