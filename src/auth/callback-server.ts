import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface CallbackResult {
  code: string;
  state: string;
}

export interface CallbackServer {
  port: number;
  redirectUri: string;
  waitForCallback(timeoutMs?: number): Promise<CallbackResult>;
  close(): void;
}

const SUCCESS_HTML = `<!doctype html><html><head><title>kanka-mcp</title></head><body style="font-family:system-ui;padding:2rem">
<h1>✓ Authorization received</h1>
<p>You can close this tab and return to your terminal.</p>
</body></html>`;

const ERROR_HTML = (msg: string) => `<!doctype html><html><head><title>kanka-mcp</title></head><body style="font-family:system-ui;padding:2rem">
<h1>✗ Authorization failed</h1>
<p>${msg}</p>
</body></html>`;

export async function startCallbackServer(preferredPort?: number): Promise<CallbackServer> {
  const server: Server = createServer();
  let resolver: ((r: CallbackResult) => void) | undefined;
  let rejecter: ((err: Error) => void) | undefined;

  server.on("request", (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/cb")) {
      res.writeHead(404).end("not found");
      return;
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    if (error) {
      res.writeHead(400, { "content-type": "text/html" }).end(ERROR_HTML(error));
      rejecter?.(new Error(`OAuth error: ${error}`));
      return;
    }
    if (!code || !state) {
      res
        .writeHead(400, { "content-type": "text/html" })
        .end(ERROR_HTML("Missing code or state"));
      rejecter?.(new Error("Callback missing code or state"));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(SUCCESS_HTML);
    resolver?.({ code, state });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(preferredPort ?? 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  // Bind to 127.0.0.1 but advertise the redirect as `localhost` — Laravel Passport
  // (which Kanka uses) rejects raw IPs in the URL validator. The browser will
  // DNS-resolve localhost back to 127.0.0.1 (or ::1) so the loopback server still receives the call.
  const redirectUri = `http://localhost:${port}/cb`;

  return {
    port,
    redirectUri,
    waitForCallback(timeoutMs = 5 * 60 * 1000) {
      return new Promise<CallbackResult>((resolve, reject) => {
        resolver = resolve;
        rejecter = reject;
        const timer = setTimeout(() => {
          reject(new Error(`OAuth callback timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref();
      });
    },
    close() {
      server.close();
    },
  };
}
