import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { talon } from "@talon/grpc-contracts";
import { config as loadDotenv } from "dotenv";
import { connectToTalond, type DaemonSession } from "./daemon-client.js";
import { toAgentEventPayload } from "./event-mapping.js";
import {
  MainToRendererChannel,
  RendererToMainChannel,
  type ApprovalDecisionPayload,
  type ApprovalRequestPayload,
  type ChannelOutputPayload,
  type ConnectionStatus,
} from "../shared/ipc-channels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Loaded from the project this app is operating on — daemon-client.ts's
// resolveDaemonConfig() reads TALON_PROJECT_ROOT, so this has to mirror its
// exact default (unset -> cwd) and run before connectToTalond() calls that.
// Never overwrites a var already exported in the real environment — that
// always wins over whatever's in the file (dotenv's default).
loadDotenv({ path: path.join(process.env["TALON_PROJECT_ROOT"] ?? process.cwd(), ".env"), quiet: true });

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      // ESM preload scripts require the sandbox disabled (Electron docs);
      // contextIsolation stays on, so contextBridge is still the only path
      // the renderer has into main — nodeIntegration never turns on at all.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on("preload-error", (_e, preloadPath, error) => {
    console.error(`[preload error] ${preloadPath}`, error);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[did-fail-load] ${code} ${desc} ${url}`);
  });
  void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  return win;
}

/**
 * §5.1's matrix splits approval UI by tier: "dangerousConfirmRequired" gets
 * a native Electron dialog (mandatory, never cached), everything else that
 * reaches PRE_APPROVAL at all (only "heuristicSandboxed" — "safeReadOnly"
 * never generates an ApprovalRequest in the first place) gets a lightweight
 * in-flow confirmation. A native dialog is modal and blocks this window, so
 * it's reserved for the tier that's supposed to interrupt the user; routing
 * both tiers through it would make every sandboxed shell command as
 * disruptive as a destructive one, which defeats the point of having two
 * tiers at all.
 */
async function resolveApprovalWithNativeDialog(
  win: BrowserWindow,
  request: talon.ApprovalRequest,
): Promise<"approved" | "denied"> {
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Deny", "Approve"],
    defaultId: 0,
    cancelId: 0,
    title: "Talon wants to run a tool",
    message: `${request.toolId} (${request.safetyTier})`,
    detail: request.inputJson,
  });
  return response === 1 ? "approved" : "denied";
}

function wireSession(win: BrowserWindow, session: DaemonSession): void {
  const { call } = session;
  const pendingRendererApprovals = new Map<string, (decision: "approved" | "denied") => void>();

  const sendMessageHandler = (_event: Electron.IpcMainEvent, text: string): void => {
    call.write(talon.ClientMessage.fromPartial({ channelInput: { text } }));
  };
  const approvalDecisionHandler = (
    _event: Electron.IpcMainEvent,
    payload: ApprovalDecisionPayload,
  ): void => {
    const resolve = pendingRendererApprovals.get(payload.callId);
    if (resolve) {
      pendingRendererApprovals.delete(payload.callId);
      resolve(payload.decision);
    }
  };

  ipcMain.on(RendererToMainChannel.SendMessage, sendMessageHandler);
  ipcMain.on(RendererToMainChannel.ApprovalDecision, approvalDecisionHandler);

  call.on("data", (msg: talon.ServerMessage) => {
    if (msg.channelOutput) {
      const payload: ChannelOutputPayload = { text: msg.channelOutput.text, isFinal: msg.channelOutput.isFinal };
      win.webContents.send(MainToRendererChannel.ChannelOutput, payload);
    } else if (msg.agentEvent) {
      const payload = toAgentEventPayload(msg.agentEvent);
      if (payload) win.webContents.send(MainToRendererChannel.AgentEvent, payload);
    } else if (msg.approvalRequest) {
      void handleApprovalRequest(win, call, msg.approvalRequest, pendingRendererApprovals);
    }
  });

  call.on("error", (error: Error) => {
    win.webContents.send(MainToRendererChannel.ConnectionStatus, {
      phase: "error",
      message: error.message,
    } satisfies ConnectionStatus);
  });
  call.on("end", () => {
    ipcMain.removeListener(RendererToMainChannel.SendMessage, sendMessageHandler);
    ipcMain.removeListener(RendererToMainChannel.ApprovalDecision, approvalDecisionHandler);
  });
}

async function handleApprovalRequest(
  win: BrowserWindow,
  call: DaemonSession["call"],
  request: talon.ApprovalRequest,
  pendingRendererApprovals: Map<string, (decision: "approved" | "denied") => void>,
): Promise<void> {
  const decision =
    request.safetyTier === "dangerousConfirmRequired"
      ? await resolveApprovalWithNativeDialog(win, request)
      : await new Promise<"approved" | "denied">((resolve) => {
          pendingRendererApprovals.set(request.callId, resolve);
          const payload: ApprovalRequestPayload = {
            callId: request.callId,
            toolId: request.toolId,
            safetyTier: request.safetyTier as ApprovalRequestPayload["safetyTier"],
            inputJson: request.inputJson,
          };
          win.webContents.send(MainToRendererChannel.ApprovalRequest, payload);
        });

  call.write(talon.ClientMessage.fromPartial({ approvalDecision: { callId: request.callId, decision } }));
}

async function main(): Promise<void> {
  await app.whenReady();
  const win = createWindow();
  // Renderer's module script (and its ipcRenderer listeners, set up via
  // preload's contextBridge API) must be running before main sends the
  // first status event, or an early send() has no listener to reach.
  await new Promise<void>((resolve) => win.webContents.once("did-finish-load", () => resolve()));

  const onStatus = (status: ConnectionStatus): void => {
    win.webContents.send(MainToRendererChannel.ConnectionStatus, status);
  };

  try {
    const session = await connectToTalond(onStatus);
    wireSession(win, session);
    // Only kills a talond this session actually spawned (DaemonSession.
    // spawnedTalond is unset when an already-running one — e.g. one
    // apps/cli is also attached to — was reused instead) — SIGTERM, not
    // -9, so talond's own shutdown() handler gets to run. Otherwise a
    // relaunch would keep reusing a daemon holding onto now-stale env vars
    // from a previous run (the exact bug a stale talond caused here).
    // Ending the stream first lets server.tryShutdown() see this call
    // close immediately, rather than waiting on the OS to notice this
    // process's fds going away once Electron actually exits.
    app.on("before-quit", () => {
      if (session.spawnedTalond === undefined) return;
      session.call.end();
      session.spawnedTalond.kill("SIGTERM");
    });
  } catch (error: unknown) {
    onStatus({ phase: "error", message: error instanceof Error ? error.message : String(error) });
  }

  app.on("window-all-closed", () => {
    app.quit();
  });
}

main().catch((error: unknown) => {
  console.error("talon desktop failed to start:", error);
  app.exit(1);
});
