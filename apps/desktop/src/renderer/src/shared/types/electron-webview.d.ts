/** Minimal typing for Electron's <webview> tag; the renderer has no electron types and only the archive viewer uses it. */
import type { DetailedHTMLProps, HTMLAttributes } from "react";

export interface PondWebviewElement extends HTMLElement {
  src: string;
  getWebContentsId(): number;
  reload(): void;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<
        HTMLAttributes<PondWebviewElement> & {
          src?: string;
          partition?: string;
        },
        PondWebviewElement
      >;
    }
  }
}
