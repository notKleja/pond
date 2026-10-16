export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}
export async function pickBrowserRegion(): Promise<CaptureRegion | null> {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:#0004;cursor:crosshair;z-index:2147483647;touch-action:none";
  const box = document.createElement("div");
  box.style.cssText =
    "position:absolute;border:2px solid white;background:#ffffff22;pointer-events:none";
  const label = document.createElement("div");
  label.textContent = "Drag to capture a region · Esc to cancel";
  label.style.cssText =
    "position:absolute;top:16px;left:50%;transform:translateX(-50%);background:#222;color:white;border-radius:8px;padding:12px;font:14px system-ui;pointer-events:none";
  overlay.append(box, label);
  document.documentElement.append(overlay);
  return new Promise((resolve) => {
    let start: { x: number; y: number } | undefined;
    const finish = (result: CaptureRegion | null) => {
      overlay.remove();
      document.removeEventListener("keydown", key, true);
      resolve(result);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    };
    document.addEventListener("keydown", key, true);
    const point = (event: PointerEvent) => ({
      x: Math.min(innerWidth, Math.max(0, event.clientX)),
      y: Math.min(innerHeight, Math.max(0, event.clientY)),
    });
    overlay.onpointercancel = () => finish(null);
    overlay.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      start = point(event);
      overlay.setPointerCapture(event.pointerId);
    };
    overlay.onpointermove = (event) => {
      if (!start) return;
      const end = point(event);
      Object.assign(box.style, {
        left: `${Math.min(start.x, end.x)}px`,
        top: `${Math.min(start.y, end.y)}px`,
        width: `${Math.abs(start.x - end.x)}px`,
        height: `${Math.abs(start.y - end.y)}px`,
      });
    };
    overlay.onpointerup = (event) => {
      if (!start) return;
      const end = point(event);
      const width = Math.abs(start.x - end.x);
      const height = Math.abs(start.y - end.y);
      finish(
        width < 2 || height < 2
          ? null
          : {
              x: Math.min(start.x, end.x),
              y: Math.min(start.y, end.y),
              width,
              height,
              viewportWidth: innerWidth,
              viewportHeight: innerHeight,
            },
      );
    };
  });
}

export async function pickPageElement(): Promise<CaptureRegion | null> {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:#0004;cursor:pointer;z-index:2147483647;touch-action:none";
  const label = document.createElement("div");
  label.textContent = "Click an element to capture. Esc to cancel.";
  label.style.cssText =
    "position:absolute;top:16px;left:50%;transform:translateX(-50%);background:#222;color:white;border-radius:8px;padding:12px;font:14px system-ui;pointer-events:none";
  overlay.append(label);
  document.documentElement.append(overlay);
  return new Promise((resolve) => {
    const finish = (result: CaptureRegion | null) => {
      overlay.remove();
      document.removeEventListener("keydown", key, true);
      resolve(result);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    };
    document.addEventListener("keydown", key, true);
    overlay.onclick = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      overlay.style.pointerEvents = "none";
      const target = document.elementFromPoint(event.clientX, event.clientY);
      overlay.style.pointerEvents = "";
      if (!target) {
        finish(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      const x = Math.min(innerWidth, Math.max(0, rect.x));
      const y = Math.min(innerHeight, Math.max(0, rect.y));
      const width = Math.min(innerWidth - x, Math.max(0, rect.width));
      const height = Math.min(innerHeight - y, Math.max(0, rect.height));
      finish(
        width < 1 || height < 1
          ? null
          : {
              x,
              y,
              width,
              height,
              viewportWidth: innerWidth,
              viewportHeight: innerHeight,
            },
      );
    };
  });
}

export async function cropScreenshot(
  dataUrl: string,
  region: CaptureRegion,
): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const sx = bitmap.width / region.viewportWidth;
    const sy = bitmap.height / region.viewportHeight;
    const x = Math.max(0, Math.round(region.x * sx));
    const y = Math.max(0, Math.round(region.y * sy));
    const width = Math.max(
      1,
      Math.min(bitmap.width - x, Math.round(region.width * sx)),
    );
    const height = Math.max(
      1,
      Math.min(bitmap.height - y, Math.round(region.height * sy)),
    );
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Screenshot cropping is unavailable.");
    context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return `data:image/png;base64,${btoa(binary)}`;
  } finally {
    bitmap.close();
  }
}

function pageCaptureState(
  operation: "start" | "scroll" | "restore",
  x = 0,
  y = 0,
) {
  const key = "data-pond-capture-scroll";
  if (operation === "restore") {
    const previous = document.documentElement
      .getAttribute(key)
      ?.split(",")
      .map(Number);
    document.documentElement.removeAttribute(key);
    document.getElementById("pond-capture-style")?.remove();
    for (const node of document.querySelectorAll("[data-pond-capture-fixed]"))
      node.removeAttribute("data-pond-capture-fixed");
    if (previous?.length === 2)
      window.scrollTo({
        left: previous[0] ?? 0,
        top: previous[1] ?? 0,
        behavior: "instant",
      });
    return null;
  }
  if (operation === "start") {
    if (document.documentElement.hasAttribute(key))
      throw new Error("A page capture is already running.");
    document.documentElement.setAttribute(key, `${scrollX},${scrollY}`);
    for (const node of document.querySelectorAll("body *")) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky")
        node.setAttribute("data-pond-capture-fixed", "");
    }
    const style = document.createElement("style");
    style.id = "pond-capture-style";
    style.textContent =
      "html{scroll-behavior:auto!important;scroll-snap-type:none!important}*{scroll-behavior:auto!important;animation-play-state:paused!important}";
    document.documentElement.append(style);
  } else {
    const style = document.getElementById("pond-capture-style");
    if (style && (x > 0 || y > 0))
      style.textContent +=
        "[data-pond-capture-fixed]{visibility:hidden!important}";
  }
  window.scrollTo({ left: x, top: y, behavior: "instant" });
  return {
    x: scrollX,
    y: scrollY,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    width: Math.max(document.documentElement.scrollWidth, innerWidth),
    height: Math.max(document.documentElement.scrollHeight, innerHeight),
    scale: devicePixelRatio,
  };
}

export async function captureFullPage(
  tabId: number,
  windowId: number,
): Promise<string> {
  let canvas: OffscreenCanvas | undefined;
  let started = false;
  const requireActiveTab = async () => {
    const [current] = await browser.tabs.query({ active: true, windowId });
    if (current?.id !== tabId)
      throw new Error("Page capture stopped because the active tab changed.");
  };
  try {
    const [initial] = await browser.scripting.executeScript({
      target: { tabId },
      func: pageCaptureState,
      args: ["start"],
    });
    const page = initial?.result;
    started = !!page;
    if (!page) throw new Error("This page cannot be captured.");
    if (page.width * page.height * page.scale ** 2 > 64_000_000)
      throw new Error("This page is too large. Capture a region instead.");
    for (let y = 0; y < page.height; y += page.viewportHeight) {
      for (let x = 0; x < page.width; x += page.viewportWidth) {
        await requireActiveTab();
        const [moved] = await browser.scripting.executeScript({
          target: { tabId },
          func: pageCaptureState,
          args: ["scroll", x, y],
        });
        const position = moved?.result;
        if (
          !position ||
          position.viewportWidth !== page.viewportWidth ||
          position.viewportHeight !== page.viewportHeight
        )
          throw new Error(
            "Page capture stopped because the window size changed.",
          );
        await new Promise((resolve) => setTimeout(resolve, 550));
        await requireActiveTab();
        const data = await browser.tabs.captureVisibleTab(windowId, {
          format: "png",
        });
        await requireActiveTab();
        const bitmap = await createImageBitmap(
          await (await fetch(data)).blob(),
        );
        try {
          const sx = bitmap.width / page.viewportWidth;
          const sy = bitmap.height / page.viewportHeight;
          canvas ??= new OffscreenCanvas(
            Math.round(page.width * sx),
            Math.round(page.height * sy),
          );
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Screenshot stitching is unavailable.");
          context.drawImage(
            bitmap,
            Math.round(position.x * sx),
            Math.round(position.y * sy),
          );
        } finally {
          bitmap.close();
        }
      }
    }
    if (!canvas) throw new Error("No page screenshot was captured.");
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
    );
    if (bytes.length > 5_000_000)
      throw new Error(
        "This screenshot is too large to transfer. Capture a smaller region.",
      );
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return `data:image/png;base64,${btoa(binary)}`;
  } finally {
    if (started)
      await browser.scripting
        .executeScript({
          target: { tabId },
          func: pageCaptureState,
          args: ["restore"],
        })
        .catch(() => {});
  }
}
