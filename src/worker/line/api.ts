export interface LineProfile {
  userId: string;
  displayName: string;
}

export type LineOutboundMessage = { type: string; [key: string]: unknown };

const lineApiBase = "https://api.line.me/v2/bot";

function logLineFailure(message: string, detail: string): void {
  console.error(JSON.stringify({ message, error: detail }));
}

function failureDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function accessToken(env: Env): string {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  return typeof token === "string" ? token.trim() : "";
}

export function lineChannelConfigured(env: Env): boolean {
  return accessToken(env) !== "";
}

export async function replyMessage(env: Env, replyToken: string, text: string): Promise<void> {
  const token = accessToken(env);

  if (token === "") {
    logLineFailure("line reply skipped", "LINE_CHANNEL_ACCESS_TOKEN is not configured");
    return;
  }

  if (replyToken === "") {
    logLineFailure("line reply skipped", "reply token is empty");
    return;
  }

  try {
    const response = await fetch(`${lineApiBase}/message/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });

    if (!response.ok) {
      logLineFailure("line reply failed", `status ${String(response.status)}`);
    }
  } catch (error) {
    logLineFailure("line reply failed", failureDetail(error));
  }
}

export async function pushMessage(env: Env, to: string, messages: readonly LineOutboundMessage[]): Promise<true | null> {
  const token = accessToken(env);

  if (token === "") {
    logLineFailure("line push skipped", "LINE_CHANNEL_ACCESS_TOKEN is not configured");
    return null;
  }

  if (to === "") {
    logLineFailure("line push skipped", "target user id is empty");
    return null;
  }

  try {
    const response = await fetch(`${lineApiBase}/message/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages }),
    });

    if (!response.ok) {
      logLineFailure("line push failed", `status ${String(response.status)}`);
      return null;
    }

    return true;
  } catch (error) {
    logLineFailure("line push failed", failureDetail(error));
    return null;
  }
}

export async function fetchProfile(env: Env, userId: string): Promise<LineProfile | null> {
  const token = accessToken(env);

  if (token === "") {
    logLineFailure("line profile skipped", "LINE_CHANNEL_ACCESS_TOKEN is not configured");
    return null;
  }

  try {
    const response = await fetch(`${lineApiBase}/profile/${encodeURIComponent(userId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      logLineFailure("line profile failed", `status ${String(response.status)}`);
      return null;
    }

    const body = await response.json<{ displayName?: string }>();
    return { userId, displayName: typeof body.displayName === "string" ? body.displayName : "" };
  } catch (error) {
    logLineFailure("line profile failed", failureDetail(error));
    return null;
  }
}
