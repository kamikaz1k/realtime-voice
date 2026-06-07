export type RealtimeClientSecretPurpose = "stt" | "tts";

export type RealtimeClientSecretRequest = {
  purpose: RealtimeClientSecretPurpose;
  language?: string;
  voice?: string;
};

export type RealtimeAuth =
  | {
      mode: "ephemeral";
      getClientSecret: (request: RealtimeClientSecretRequest) => Promise<string>;
    }
  | {
      mode: "proxy";
      url: string;
      getAuthHeaders?: () => Promise<Record<string, string>>;
    };

export async function getEphemeralClientSecret(
  auth: RealtimeAuth,
  request: RealtimeClientSecretRequest,
): Promise<string> {
  if (auth.mode !== "ephemeral") {
    throw new Error("Only ephemeral auth is implemented in the browser packages.");
  }

  return auth.getClientSecret(request);
}
