(() => {
  // src/component.js
  var initialized = false;
  function installTavernInput() {
    if (document.getElementById("send_textarea")) return;
    const holder = document.createElement("div");
    holder.hidden = true;
    const textarea = document.createElement("textarea");
    textarea.id = "send_textarea";
    const button = document.createElement("button");
    button.id = "send_but";
    button.type = "button";
    const send = () => {
      if (typeof window.sendUserMessage === "function") window.sendUserMessage(textarea.value);
    };
    button.addEventListener("click", send);
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });
    holder.append(textarea, button);
    document.body.append(holder);
  }
  window.addEventListener("message", async (event) => {
    if (initialized || event.source !== parent || event.data?.type !== "tavern-component" || !event.ports[0]) return;
    initialized = true;
    const port = event.ports[0];
    try {
      let hub;
      for (let index = 0; index < parent.length; index++) {
        try {
          if (parent[index].__tavernHubId === event.data.hubId) {
            hub = parent[index];
            break;
          }
        } catch {
        }
      }
      if (!hub) throw new Error("\u5F53\u524D\u89D2\u8272\u524D\u7AEF\u5C1A\u672A\u51C6\u5907\u597D");
      hub.__tavernExpose(window, event.data.index);
      installTavernInput();
      const frame = document.createElement("iframe");
      frame.title = "\u89D2\u8272\u5361\u524D\u7AEF\u7EC4\u4EF6";
      frame.scrolling = "no";
      frame.srcdoc = hub.__tavernComponentHtml(await hub.__tavernPrepareHtml(event.data.html), event.data.index);
      document.body.append(frame);
      let scheduled = false;
      const resize = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          const height = Math.max(24, document.body.scrollHeight);
          port.postMessage({ type: "height", height });
        });
      };
      window.__tavernResize = resize;
      new ResizeObserver(resize).observe(document.body);
      resize();
    } catch (error) {
      port.postMessage({ type: "error", message: error.message });
    }
  });
})();
