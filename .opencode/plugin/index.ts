import type { Plugin } from "@opencode-ai/plugin";
import { createController, type PluginEvent } from "./core";

export const CaffeinatePlugin: Plugin = async ({ client }) => {
  const log = (message: string, level: "info" | "warn" | "debug" | "error" = "info") => {
    client.app.log({ body: { service: "opencode-caffeinate", level, message } }).catch(() => {});
  };

  if (process.platform !== "darwin") {
    log("Plugin disabled: only available on macOS", "warn");
    return {};
  }

  const controller = createController(log);
  log("Plugin initialized", "info");

  return {
    event: async ({ event }: { event: PluginEvent }) => controller.handle(event),
    dispose: controller.dispose,
  };
};

export default CaffeinatePlugin;
