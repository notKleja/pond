import { resolve } from "node:path";
import { FIREFOX_EXTENSION_ID } from "@pond/schema/native";
import { defineConfig } from "wxt";

/** Pinned public key so unpacked and store builds share `EXTENSION_ID` in `@pond/schema/native`. */
const EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3Zo8eCTaDeFH3Cc8yLtm6FiH3ALU8SMbH+oTFnjzBbD1+zUy1chc0P4c62tYvW4rBiO3CKt2Ycn3u1PmbkBPzuu/65YA7AZMA9+Oyp3QHhsjC1lED4EdCKQJK2WuyLv0k4kG22HQGUN83n9vdx/fPYRk3IL4yFplWUrcsApFOVAIVvhoMizpYfnBvey64aY9FTAFSKd+iYyA7J/yVzRh4AyjYRJFlmdA8K9aMaGZ/Ta4UvUrqoGBkgyGGH+hoVsPvgxW/+w5+JWAThT9ApAVEeuuZp9LeNwmnI2zUFxS0JRf6LHIDy7kbtTOVW5g9eOaS9G3Gs13j2VPC1Yyu7zxTQIDAQAB";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  /** Pin to 3001 with strictPort so dev never collides with the website's Next server. */
  dev: {
    server: {
      port: 3001,
      strictPort: true,
      origin: "http://localhost:3001",
    },
  },
  webExt: {
    disabled: true,
  },
  vite: () => ({
    resolve: {
      alias: {
        "@pond/ui": resolve(__dirname, "../../packages/ui/src"),
      },
    },
  }),
  manifest: ({ browser }) => ({
    name: "Pond",
    version: "1.0.1",
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: FIREFOX_EXTENSION_ID,
              strict_min_version: "140.0",
              data_collection_permissions: {
                required: [
                  "authenticationInfo",
                  "browsingActivity",
                  "websiteActivity",
                  "websiteContent",
                ],
              },
            },
          },
        }
      : { key: EXTENSION_KEY }),
    description:
      "Capture saves from Twitter/X, Instagram, Pinterest, Are.na, Cosmos, TikTok, YouTube, Reddit, Threads, and web articles into one place.",
    icons: {
      16: "icons/16.png",
      32: "icons/32.png",
      48: "icons/48.png",
      128: "icons/128.png",
    },
    action: {
      default_title: "Save to Pond",
      default_icon: {
        16: "icons/16.png",
        32: "icons/32.png",
        48: "icons/48.png",
        128: "icons/128.png",
      },
    },
    web_accessible_resources: [
      {
        resources: ["icons/brand/icon.svg"],
        matches: ["<all_urls>"],
      },
    ],
    permissions: [
      "storage",
      "activeTab",
      "scripting",
      "tabs",
      "cookies",
      "contextMenus",
      "nativeMessaging",
      "alarms",
    ],
    host_permissions: [
      "https://x.com/*",
      "https://twitter.com/*",
      "https://www.instagram.com/*",
      "https://www.pinterest.com/*",
      "https://*.pinterest.com/*",
      "https://www.are.na/*",
      "https://are.na/*",
      "https://www.cosmos.so/*",
      "https://cosmos.so/*",
      "https://www.tiktok.com/*",
      "https://www.youtube.com/*",
      "https://m.youtube.com/*",
      "<all_urls>",
    ],
  }),
});
