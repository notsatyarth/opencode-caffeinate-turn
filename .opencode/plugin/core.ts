import { SessionManager } from "./session-manager";
import { CaffeinateManager } from "./caffeinate-manager";
import { FileLock } from "./lock";
import { defaultBaseDir, ensureSecureDir, isValidSessionID } from "./paths";
import { join } from "path";

export type PluginEvent = { type: string; properties?: any; data?: any };
type Level = "info" | "warn" | "debug" | "error";

const ACQUIRE = new Set([
  "question.replied",
  "question.v2.replied",
  "permission.replied",
  "permission.v2.replied",
  "form.replied",
  "session.execution.started",
]);

const RELEASE = new Set([
  "question.asked",
  "question.v2.asked",
  "question.rejected",
  "question.v2.rejected",
  "permission.asked",
  "permission.v2.asked",
  "permission.updated",
  "form.created",
  "form.cancelled",
  "session.idle",
  "session.error",
  "session.deleted",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
]);

export function createController(log: (message: string, level?: Level) => void) {
  const baseDir = defaultBaseDir();
  ensureSecureDir(baseDir);
  const lockPath = join(baseDir, "state.lock");
  const sessionManager = new SessionManager();
  const caffeinateManager = new CaffeinateManager();
  const mine = new Set<string>();

  const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const lock = new FileLock(lockPath);
    await lock.acquire();
    try {
      return await fn();
    } finally {
      lock.release();
    }
  };

  const acquire = (sessionID: string) =>
    withLock(async () => {
      mine.add(sessionID);
      sessionManager.registerSession(process.pid, sessionID);
      if (caffeinateManager.isRunning()) return;
      try {
        await caffeinateManager.start();
        log(`caffeinate started (PID: ${caffeinateManager.getPid()})`, "info");
      } catch (error) {
        log(`Failed to start caffeinate: ${error}`, "error");
      }
    });

  const release = (sessionID: string) =>
    withLock(async () => {
      mine.delete(sessionID);
      sessionManager.unregisterSession(process.pid, sessionID);
      if (sessionManager.hasActiveSessions()) return;
      if (caffeinateManager.isRunning()) {
        try {
          const pid = caffeinateManager.getPid();
          await caffeinateManager.stop();
          log(`caffeinate stopped (PID: ${pid})`, "info");
        } catch (error) {
          log(`Failed to stop caffeinate: ${error}`, "error");
        }
      }
    });

  return {
    handle: async (event: PluginEvent) => {
      const props = event.properties ?? event.data ?? {};
      const sessionID: string | undefined = props.sessionID ?? props.info?.id ?? props.form?.sessionID;
      if (!isValidSessionID(sessionID)) return;

      if (event.type === "session.status") {
        const status = props.status?.type;
        if (status === "busy" || status === "retry") await acquire(sessionID);
        else if (status === "idle") await release(sessionID);
      } else if (ACQUIRE.has(event.type)) {
        await acquire(sessionID);
      } else if (RELEASE.has(event.type)) {
        await release(sessionID);
      }
    },
    dispose: async () => {
      for (const id of [...mine]) await release(id);
    },
  };
}
