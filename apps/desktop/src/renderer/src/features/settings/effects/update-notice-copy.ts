import type { UpdateNotice } from "@shared/update-notice";

export function updateNoticeCopy(notice: UpdateNotice) {
  if (notice.phase === "downloaded") {
    return {
      title: "Update ready",
      description: `Restart to finish installing Pond ${notice.version}.`,
      action: "Restart" as const,
    };
  }
  if (notice.downloading) {
    return {
      title: "Update available",
      description: `Pond ${notice.version} is downloading.`,
    };
  }
  return {
    title: "Update available",
    description: `Pond ${notice.version} is ready to download.`,
    action: "Download" as const,
  };
}
