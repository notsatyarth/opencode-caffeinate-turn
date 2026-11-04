import type { Plugin } from "@opencode-ai/plugin";
import { SessionManager } from "./session-manager";
import { CaffeinateManager } from "./caffeinate-manager";

type PluginEvent = { type: string; properties?: any; data?: any };

export const CaffeinatePlugin: Plugin = async ({ client }) => {
  const SERVICE_NAME = "opencode-caffeinate";

  const logFn = (message: string, level: "info" | "warn" | "debug" | "error" = "info") => {
    client.app.log({
      body: {
        service: SERVICE_NAME,
        level,
        message,
      },
    }).catch(() => {});
  };

  if (process.platform !== "darwin") {
    logFn("Plugin disabled: only available on macOS", "warn");
    return {};
  }

  const sessionManager = new SessionManager();
  const caffeinateManager = new CaffeinateManager();

  logFn("Plugin initialized", "info");

  const acquire = async (sessionID: string) => {
    sessionManager.registerSession(process.pid, sessionID);

    if (caffeinateManager.isRunning()) return;

    try {
      await caffeinateManager.start();
      logFn(`caffeinate started (PID: ${caffeinateManager.getPid()})`, "info");
    } catch (error) {
      logFn(`Failed to start caffeinate: ${error}`, "error");
    }
  };

  const release = async (sessionID: string) => {
    sessionManager.unregisterSession(process.pid, sessionID);

    if (sessionManager.hasActiveSessions()) return;

    if (caffeinateManager.isRunning()) {
      try {
        const pid = caffeinateManager.getPid();
        await caffeinateManager.stop();
        logFn(`caffeinate stopped (PID: ${pid})`, "info");
      } catch (error) {
        logFn(`Failed to stop caffeinate: ${error}`, "error");
      }
    }
  };

  return {
    event: async ({ event }: { event: PluginEvent }) => {
      const props = event.properties ?? event.data ?? {};
      const sessionID: string | undefined = props.sessionID ?? props.info?.id;
      if (!sessionID) return;

      switch (event.type) {
        // Agent is working: keep the machine awake.
        case "session.status": {
          const status = props.status?.type;
          if (status === "busy" || status === "retry") {
            await acquire(sessionID);
          } else if (status === "idle") {
            await release(sessionID);
          }
          break;
        }

        // Waiting on the user (question or permission prompt): allow sleep.
        case "question.asked":
        case "question.v2.asked":
        case "permission.asked":
        case "permission.v2.asked":
        case "permission.updated":
          await release(sessionID);
          break;

        // User answered: agent resumes work.
        case "question.replied":
        case "question.v2.replied":
        case "permission.replied":
        case "permission.v2.replied":
          await acquire(sessionID);
          break;

        // Rejected question/aborted turn ends the work.
        case "question.rejected":
        case "question.v2.rejected":
        case "session.idle":
        case "session.error":
        case "session.deleted":
          await release(sessionID);
          break;
      }
    },
  };
};

export default CaffeinatePlugin;
