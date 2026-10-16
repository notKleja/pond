import type { AppMenuContext, AppMenuItem } from "./types";

export function buildEditSection(
  context: AppMenuContext,
  settingsItem: AppMenuItem,
): AppMenuItem {
  const { accelerator, sendMenuAction } = context;

  return {
    label: "Edit",
    submenu: [
      {
        label: "Undo",
        accelerator: "CmdOrCtrl+Z",
        click: context.edit.undo,
      },
      {
        label: "Redo",
        accelerator: "CmdOrCtrl+Shift+Z",
        click: context.edit.redo,
      },
      { type: "separator" },
      {
        label: "Cut",
        accelerator: "CmdOrCtrl+X",
        click: context.edit.cut,
      },
      {
        label: "Copy",
        accelerator: "CmdOrCtrl+C",
        click: context.edit.copy,
      },
      {
        label: "Paste",
        accelerator: "CmdOrCtrl+V",
        click: context.edit.paste,
      },
      {
        label: "Select All",
        accelerator: "CmdOrCtrl+A",
        registerAccelerator: false,
        click: context.edit.selectAll,
      },
      { type: "separator" },
      {
        label: "Select All Saves",
        accelerator: accelerator("grid.select-all"),
        registerAccelerator: false,
        click: sendMenuAction("selection.select-all"),
      },
      {
        label: "Clear Save Selection",
        accelerator: accelerator("grid.clear"),
        registerAccelerator: false,
        click: sendMenuAction("selection.clear"),
      },
      {
        label: "Invert Save Selection",
        click: sendMenuAction("selection.invert"),
      },
      { type: "separator" },
      {
        label: "Copy Save",
        submenu: [
          {
            label: "Copy Image or Video",
            accelerator: accelerator("save.copy-image"),
            registerAccelerator: false,
            click: sendMenuAction("save.copy-media"),
          },
          {
            label: "Copy URL",
            accelerator: accelerator("save.copy-url"),
            registerAccelerator: false,
            click: sendMenuAction("save.copy-url"),
          },
          {
            label: "Copy Pond Link",
            click: sendMenuAction("save.copy-pond-link"),
          },
          {
            label: "Copy Name",
            click: sendMenuAction("save.copy-name"),
          },
          {
            label: "Copy File Path",
            click: sendMenuAction("save.copy-file-path"),
          },
          {
            label: "Copy Save ID",
            accelerator: accelerator("save.copy-id"),
            registerAccelerator: false,
            click: sendMenuAction("save.copy-id"),
          },
          {
            label: "Copy Tags",
            accelerator: accelerator("save.copy-tags"),
            registerAccelerator: false,
            click: sendMenuAction("save.copy-tags"),
          },
          {
            label: "Paste Tags",
            accelerator: accelerator("save.paste-tags"),
            registerAccelerator: false,
            click: sendMenuAction("save.paste-tags"),
          },
        ],
      },
      { type: "separator" },
      {
        label: "Move Selected to Trash",
        click: sendMenuAction("save.bulk-trash"),
      },
      {
        label: "Refresh Selected",
        click: sendMenuAction("save.bulk-refresh"),
      },
      {
        label: "Remove from Current Folder",
        click: sendMenuAction("save.remove-current-folder"),
      },
      {
        label: "Switch Library",
        click: sendMenuAction("library.open"),
      },
      ...(!context.isMac ? [{ type: "separator" as const }, settingsItem] : []),
    ],
  };
}
