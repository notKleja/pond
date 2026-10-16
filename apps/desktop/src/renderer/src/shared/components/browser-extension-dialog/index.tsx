import { Button, Dialog } from "@pond/ui";
import type { ExtensionBrowser } from "@shared/browser-extension-contracts";
import { useReducedMotion } from "motion/react";
import { useState } from "react";
import installPoster from "@/assets/extension-install.jpg";
import installVideo from "@/assets/extension-install.mp4";
import { errorCopy } from "@/shared/lib/error-copy";
import styles from "./styles.module.css";

type Status =
  | { kind: "idle" }
  | { kind: "saving"; browser: ExtensionBrowser }
  | { kind: "saved"; browser: ExtensionBrowser }
  | { kind: "error"; message: string };

export function BrowserExtensionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function download(browser: ExtensionBrowser): Promise<void> {
    setStatus({ kind: "saving", browser });
    try {
      const result = await window.pond.query(
        "extension.install",
        browser === "firefox" ? { browser } : {},
      );
      setStatus(
        result.ok
          ? { kind: "saved", browser }
          : { kind: "error", message: result.error },
      );
    } catch (cause) {
      setStatus({
        kind: "error",
        message: errorCopy(
          cause,
          "Pond couldn't save the extension. Try again.",
        ),
      });
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => !next && setStatus({ kind: "idle" })}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className={styles.popup}>
          <div className={styles.hero}>
            <div className={styles.window}>
              <video
                className={styles.video}
                src={installVideo}
                poster={installPoster}
                autoPlay={!reduceMotion}
                controls={reduceMotion ?? false}
                loop
                muted
                playsInline
                aria-label="Installing the Pond extension from chrome://extensions"
              />
            </div>
          </div>
          <div className={styles.body}>
            <Dialog.Title className={styles.title}>
              Browser Extension
            </Dialog.Title>
            <Dialog.Description>
              Save pages and images from Chrome, Arc, Brave, Edge, Firefox, or
              Zen into your library.
            </Dialog.Description>
            {status.kind === "saved" && status.browser === "firefox" ? (
              <ol className={styles.steps}>
                <li>
                  Click Download for Firefox to add a Pond Extension Firefox
                  folder to Downloads.
                </li>
                <li>
                  Open <code>about:debugging</code> and choose this browser.
                </li>
                <li>
                  Click Load Temporary Add-on and choose manifest.json in that
                  folder.
                </li>
              </ol>
            ) : (
              <ol className={styles.steps}>
                <li>
                  Click Download to add a Pond Extension folder to Downloads.
                </li>
                <li>
                  Open <code>chrome://extensions</code> and turn on Developer
                  mode.
                </li>
                <li>
                  Click Load unpacked and choose the Pond Extension folder.
                </li>
              </ol>
            )}
            {status.kind === "saved" ? (
              <p className={styles.status}>
                {status.browser === "firefox"
                  ? "Pond Extension Firefox is in your Downloads folder."
                  : "Pond Extension is in your Downloads folder."}
              </p>
            ) : null}
            {status.kind === "error" ? (
              <p className={styles.error}>{status.message}</p>
            ) : null}
            <div className={styles.actions}>
              <Button
                variant="secondary"
                loading={
                  status.kind === "saving" && status.browser === "firefox"
                }
                onClick={() => void download("firefox")}
              >
                Download for Firefox
              </Button>
              <Button
                loading={
                  status.kind === "saving" && status.browser === "chrome"
                }
                onClick={() => void download("chrome")}
              >
                Download
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
