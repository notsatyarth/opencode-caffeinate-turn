// OpenCode v2 native plugin entry: Plugin.define({ id, setup(ctx) }).
// `@opencode/plugin` is provided by the host at runtime.
// @ts-ignore
import { Plugin } from "@opencode/plugin";
import { createController } from "./core";

export default Plugin.define({
  id: "caffeinate",
  setup(ctx: any) {
    if (process.platform !== "darwin") return;

    const abort = new AbortController();
    const controller = createController((message, level) => {
      if (level === "error" || level === "warn") console.error(`caffeinate: ${message}`);
    });

    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        await controller.handle(event).catch(() => {});
      }
    })().catch(() => {});

    return () => {
      abort.abort();
      void controller.dispose();
    };
  },
});
