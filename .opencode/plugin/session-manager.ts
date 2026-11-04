import { existsSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { defaultBaseDir, ensureSecureDir, isValidSessionID } from "./paths";

export class SessionManager {
  private sessionsDir: string;

  constructor(sessionsDir?: string) {
    if (sessionsDir) {
      this.sessionsDir = sessionsDir;
    } else {
      const base = defaultBaseDir();
      ensureSecureDir(base);
      this.sessionsDir = join(base, "sessions");
    }
    ensureSecureDir(this.sessionsDir);
  }

  private fileFor(pid: number, sessionID?: string): string {
    if (!Number.isSafeInteger(pid) || pid <= 1) {
      throw new Error(`invalid pid: ${pid}`);
    }
    if (sessionID !== undefined && !isValidSessionID(sessionID)) {
      throw new Error("invalid session id");
    }
    const name = sessionID ? `${pid}_${sessionID}.session` : `${pid}.session`;
    return join(this.sessionsDir, name);
  }

  registerSession(pid: number, sessionID?: string): void {
    writeFileSync(this.fileFor(pid, sessionID), "", { flag: "w", mode: 0o600 });
  }

  unregisterSession(pid: number, sessionID?: string): void {
    const sessionFile = this.fileFor(pid, sessionID);
    if (existsSync(sessionFile)) {
      unlinkSync(sessionFile);
    }
  }

  getActiveSessions(): number[] {
    if (!existsSync(this.sessionsDir)) {
      return [];
    }

    const files = readdirSync(this.sessionsDir);
    const activeSessions: number[] = [];

    for (const file of files) {
      const match = file.match(/^(\d{1,10})(?:_[A-Za-z0-9_-]{1,128})?\.session$/);
      if (match) {
        const pid = Number(match[1]);
        if (pid > 1 && this.isProcessAlive(pid)) {
          activeSessions.push(pid);
        }
      }
    }

    return activeSessions;
  }

  hasActiveSessions(): boolean {
    return this.getActiveSessions().length > 0;
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: any) {
      if (error.code === "ESRCH") {
        return false;
      }
      if (error.code === "EPERM") {
        return true;
      }
      return false;
    }
  }
}
