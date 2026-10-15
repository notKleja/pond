import type { SectionConfig } from "@/features/settings/components/engine";
import { LibrarySettings } from "@/features/settings/components/sections/library";
import { trashSection } from "@/features/settings/lib/config-trash";

export const librarySection: SectionConfig = {
  title: "Library",
  description: "Change how the open library appears.",
  keywords: [
    "library",
    "identity",
    "name",
    "logo",
    "icon",
    "replication",
    "sync",
    "mac",
    "windows",
    "exchange",
  ],
  groups: [
    {
      title: "Library",
      fullWidth: true,
      render: () => <LibrarySettings />,
    },
    ...(trashSection.groups ?? []).map((group) => ({
      ...group,
      prefsKey: "trash" as const,
    })),
  ],
};
