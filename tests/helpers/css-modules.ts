import { registerHooks } from "node:module";

// Component tests import files that import CSS Modules; Node cannot, so every .css becomes a proxy
// whose class names are the keys themselves (styles.root === "root"). Imported once, before the component.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", shortCircuit: true, source: "export default new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) });" };
    }
    return nextLoad(url, context);
  },
});
