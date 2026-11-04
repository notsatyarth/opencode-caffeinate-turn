import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { currentUid, defaultBaseDir, ensureSecureDir } from "./paths";

const CAFFEINATE_BIN = "/usr/bin/caffeinate";
const PS_BIN = "/bin/ps";

export function isOwnCaffeinate(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    const result = Bun.spawnSync([PS_BIN, "-p", String(pid), "-o", "uid=,comm="]);
    if (result.exitCode !== 0) return false;
    const match = result.stdout.toString().trim().match(/^(\d+)\s+(.+)$/);
    if (!match) return false;
    return Number(match[1]) === currentUid() && basename(match[2]!) === "caffeinate";
  } catch {
    return false;
  }
}

export class CaffeinateManager {
  private pidFile: string;
  private process: any = null;

  constructor(pidFile?: string) {
    if (pidFile) {
      this.pidFile = pidFile;
    } else {
      const base = defaultBaseDir();
      ensureSecureDir(base);
      this.pidFile = join(base, "caffeinate.pid");
    }
  }

  async start(): Promise<void> {
    if (this.isRunning()) {
      return;
    }

    try {
      this.process = Bun.spawn([CAFFEINATE_BIN, "-dim"], {
        stdout: "ignore",
        stderr: "ignore",
      });

      const tmp = join(dirname(this.pidFile), `.caffeinate.pid.${process.pid}.tmp`);
      writeFileSync(tmp, String(this.process.pid), { mode: 0o600 });
      renameSync(tmp, this.pidFile);
    } catch (error) {
      throw new Error(`Failed to start caffeinate: ${error}`);
    }
  }

  async stop(): Promise<void> {
    const pid = this.getPid();
    if (pid && isOwnCaffeinate(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error: any) {
        if (error.code !== "ESRCH") {
          throw error;
        }
      }
    }

    if (this.process) {
      try {
        this.process.kill();
      } catch {}
      this.process = null;
    }

    if (existsSync(this.pidFile)) {
      unlinkSync(this.pidFile);
    }
  }

  isRunning(): boolean {
    const pid = this.getPid();
    if (!pid) {
      return false;
    }

    return isOwnCaffeinate(pid);
  }

  getPid(): number | null {
    if (this.process) {
      if (this.process.exitCode === null && this.process.pid) {
        return this.process.pid;
      }
      this.process = null;
    }

    try {
      const pidStr = readFileSync(this.pidFile, "utf-8").trim();
      if (!/^\d{1,10}$/.test(pidStr)) {
        return null;
      }
      const pid = Number(pidStr);
      return pid > 1 ? pid : null;
    } catch {
      return null;
    }
  }
}
