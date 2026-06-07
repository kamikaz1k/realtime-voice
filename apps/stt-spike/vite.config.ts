import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

type Candidate = "whisper_manual" | "server_vad_realtime";

type TokenRequest = {
  candidate?: Candidate;
  language?: string;
  safetyIdentifier?: string;
};

const OPENAI_CLIENT_SECRET_URL =
  "https://api.openai.com/v1/realtime/client_secrets";
const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = join(CONFIG_DIR, "../..");

function buildSession(candidate: Candidate, language?: string) {
  if (candidate === "whisper_manual") {
    return {
      type: "transcription",
      audio: {
        input: {
          transcription: {
            model: "gpt-realtime-whisper",
            ...(language ? { language } : {}),
            delay: "low",
          },
          turn_detection: null,
        },
      },
    };
  }

  return {
    type: "realtime",
    model: "gpt-realtime",
    instructions:
      "This is a transcription-only spike. Do not produce assistant content unless explicitly requested.",
    output_modalities: ["text"],
    max_output_tokens: 1,
    tools: [],
    tool_choice: "none",
    audio: {
      input: {
        transcription: {
          model: "gpt-4o-transcribe",
          ...(language ? { language } : {}),
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
          create_response: false,
          interrupt_response: false,
        },
      },
    },
  };
}

async function readJsonBody(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as TokenRequest;
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function realtimeTokenPlugin(apiKey: string | undefined): Plugin {
  return {
    name: "stt-spike-realtime-token",
    configureServer(server) {
      server.middlewares.use("/api/realtime-token", async (req, res) => {
        if (req.method !== "POST") {
          json(res, 405, { error: "Method not allowed" });
          return;
        }

        const resolvedApiKey = apiKey || readApiKeyFromEnvFile();

        if (!resolvedApiKey) {
          json(res, 500, {
            error:
              "OPENAI_API_KEY is not set. Add it to .env.local, apps/stt-spike/.env.local, or export it before running the spike dev server.",
          });
          return;
        }

        try {
          const body = await readJsonBody(req);
          const candidate = body.candidate ?? "whisper_manual";
          const session = buildSession(candidate, body.language);
          const headers: Record<string, string> = {
            Authorization: `Bearer ${resolvedApiKey}`,
            "Content-Type": "application/json",
          };

          if (body.safetyIdentifier) {
            headers["OpenAI-Safety-Identifier"] = body.safetyIdentifier;
          }

          const upstream = await fetch(OPENAI_CLIENT_SECRET_URL, {
            method: "POST",
            headers,
            body: JSON.stringify({
              expires_after: {
                anchor: "created_at",
                seconds: 600,
              },
              session,
            }),
          });

          const text = await upstream.text();
          let parsed: unknown;

          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { raw: text };
          }

          if (!upstream.ok) {
            json(res, upstream.status, {
              error: "OpenAI client secret request failed",
              details: parsed,
            });
            return;
          }

          json(res, 200, parsed);
        } catch (error) {
          json(res, 500, {
            error: error instanceof Error ? error.message : "Unknown token error",
          });
        }
      });
    },
  };
}

function readApiKeyFromEnvFile() {
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

  return undefined;
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

    if (!match || match[1] !== key) {
      continue;
    }

    return match[2].trim().replace(/^['"]|['"]$/g, "");
  }

  return undefined;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;

  return {
    plugins: [react(), realtimeTokenPlugin(apiKey)],
    server: {
      port: 5173,
    },
  };
});
