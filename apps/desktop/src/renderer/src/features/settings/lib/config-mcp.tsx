import {
  defineCustomSection,
  group,
} from "@/features/settings/lib/engine-types";

export const mcpSection = defineCustomSection({
  title: "Model Context Protocol",
  description: "Let Cursor and Claude search this library over local stdio.",
  keywords: [
    "mcp",
    "model context protocol",
    "cursor",
    "stdio",
    "claude",
    "client",
    "mcp.json",
    "library",
    "access",
    "agents",
  ],
  groups: [
    group.plain({
      items: [
        {
          control: "custom",
          key: "access",
          title: "Access",
          keywords: ["search", "open", "actions", "export"],
          render: () => null,
        },
        {
          control: "custom",
          key: "agents",
          title: "Agents",
          keywords: ["cursor", "claude", "codex", "gemini", "vscode"],
          render: () => null,
        },
        {
          control: "custom",
          key: "advanced",
          title: "Advanced",
          keywords: ["config", "command", "binary", "--mcp", "copy"],
          render: () => null,
        },
      ],
    }),
  ],
});
