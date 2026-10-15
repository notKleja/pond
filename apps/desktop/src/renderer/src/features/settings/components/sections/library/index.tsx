import { Button, Input, Select, Settings, Tooltip } from "@pond/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import defaultAppIcon from "@/generated/app-icon-previews/aqua.png";
import { errorCopy } from "@/shared/lib/error-copy";
import styles from "./styles.module.css";

const LibraryInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
});

type LibraryInfo = z.infer<typeof LibraryInfoSchema>;

function libraryFolderName(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.pond$/i, "") ?? ""
  );
}

export function LibrarySettings() {
  const { data: info } = useQuery({
    queryKey: ["library-info"],
    queryFn: async () =>
      LibraryInfoSchema.parse(await window.pond.query("library.info", {})),
  });
  const { data: recent = [] } = useQuery({
    queryKey: ["recent-libraries"],
    queryFn: () => window.pond.query("library.recent", {}),
  });

  const openRecent = useMutation({
    mutationFn: async (path: string) => {
      const result = await window.pond.query("library.switchTo", { path });
      if (!result.ok) throw new Error(result.error ?? "Couldn't open library.");
    },
  });

  return (
    <Settings.List>
      <LibraryIdentitySettings info={info} />
      <LibraryReplicationSettings />
      {recent.length > 1 ? (
        <Settings.Item id="setting-library-recent">
          <Settings.ItemDetails>
            <Settings.ItemTitle>Recent Libraries</Settings.ItemTitle>
            <Settings.ItemDescription>
              Switch to a library you've opened before.
              <StatusNote error={openRecent.error?.message} />
            </Settings.ItemDescription>
          </Settings.ItemDetails>
          <Settings.ItemControl>
            <Select.Root
              value={recent.find((entry) => entry.active)?.path ?? ""}
              disabled={openRecent.isPending}
              onValueChange={(path) => {
                if (path) openRecent.mutate(path);
              }}
            >
              <Select.Trigger aria-label="Recent Libraries">
                <Select.Value>
                  {(path: string) =>
                    recent.find((entry) => entry.path === path)?.name ??
                    "Choose Library"
                  }
                </Select.Value>
              </Select.Trigger>
              <Select.Portal>
                <Select.Positioner sideOffset={6}>
                  <Select.Popup>
                    <Select.Items
                      items={recent.map((entry) => ({
                        value: entry.path,
                        label: entry.available
                          ? entry.name
                          : `${entry.name} (Unavailable)`,
                        disabled: !entry.available,
                      }))}
                    />
                  </Select.Popup>
                </Select.Positioner>
              </Select.Portal>
            </Select.Root>
          </Settings.ItemControl>
        </Settings.Item>
      ) : null}
    </Settings.List>
  );
}

function LibraryReplicationSettings() {
  const client = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["library-replication-status"],
    queryFn: () => window.pond.query("library.replication.status", {}),
    refetchInterval: 30_000,
  });
  const configure = useMutation({
    mutationFn: async (exchangeDirectory: string | null) => {
      const result = await window.pond.query("library.replication.set", {
        exchangeDirectory,
      });
      if (!result.ok)
        throw new Error(result.error ?? "Couldn't configure replication.");
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ["library-replication-status"],
      });
    },
  });

  const choose = async () => {
    const result = await window.pond.query(
      "library.replication.pickFolder",
      {},
    );
    if (!result.ok) return;
    await configure.mutateAsync(result.path);
  };

  const detail = status?.enabled
    ? `Exchange: ${status.exchangeDirectory ?? "Unknown"}`
    : "Choose the same synced exchange folder on each computer. Each computer must use its own local Library fork; Pond never opens SQLite or a Library bundle through the exchange folder.";
  const activity = status?.lastError
    ? status.lastError
    : status?.lastRunAt
      ? `Last checked ${new Date(status.lastRunAt).toLocaleString()}. Published ${status.lastResult?.published ?? 0}; applied ${status.lastResult?.applied ?? 0}.`
      : null;
  const replicationError =
    configure.error?.message ??
    status?.lastError ??
    (status?.lastResult?.rejected
      ? `${status.lastResult.rejected} exchange bundle${status.lastResult.rejected === 1 ? " was" : "s were"} rejected. Let the file service finish, then check again.`
      : null);

  return (
    <Settings.Item id="setting-library-replication">
      <Settings.ItemDetails>
        <Settings.ItemTitle>Mac + Windows Replication</Settings.ItemTitle>
        <Settings.ItemDescription>
          {detail}
          {activity ? (
            <span className={styles.replicationStatus}>{activity}</span>
          ) : null}
          <StatusNote error={replicationError} />
        </Settings.ItemDescription>
      </Settings.ItemDetails>
      <Settings.ItemControl>
        {status?.enabled ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={configure.isPending}
            onClick={() => configure.mutate(null)}
          >
            Turn Off
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={configure.isPending}
          onClick={() => void choose()}
        >
          {status?.enabled ? "Change Folder" : "Choose Exchange Folder"}
        </Button>
      </Settings.ItemControl>
    </Settings.Item>
  );
}

function LibraryIdentitySettings({ info }: { info?: LibraryInfo }) {
  const client = useQueryClient();
  const [name, setName] = useState(info?.name ?? "");
  const [logo, setLogo] = useState<string | null>(info?.icon ?? null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [nameBusy, setNameBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => setName(info?.name ?? ""), [info?.name]);
  useEffect(() => setLogo(info?.icon ?? null), [info?.icon]);

  const refreshIdentity = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["library-info"] }),
      client.invalidateQueries({ queryKey: ["recent-libraries"] }),
    ]);
  };

  const updateLogo = async (nextLogo: string | null) => {
    const result = await window.pond.query("library.identity.update", {
      icon: nextLogo,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    setLogo(nextLogo);
    await refreshIdentity();
  };

  const chooseLogo = async () => {
    setLogoBusy(true);
    setLogoError(null);
    try {
      const result = await window.pond.query("library.identity.pickIcon", {});
      if (!result.ok) {
        if (result.reason !== "cancelled")
          setLogoError("Choose a supported image.");
        return;
      }
      await updateLogo(result.icon);
    } catch (error) {
      setLogoError(errorCopy(error, "Couldn't choose the logo. Try again."));
    } finally {
      setLogoBusy(false);
    }
  };

  const resetLogo = async () => {
    setLogoBusy(true);
    setLogoError(null);
    try {
      await updateLogo(null);
    } catch (error) {
      setLogoError(errorCopy(error, "Couldn't reset the logo. Try again."));
    } finally {
      setLogoBusy(false);
    }
  };

  const saveName = async () => {
    if (!info || nameBusy) return;
    const nextName = name.trim().replace(/\.pond$/i, "");
    if (!nextName) {
      setNameError("Enter a library name.");
      return;
    }
    if (nextName === info.name) {
      setName(info.name);
      setNameError(null);
      return;
    }
    setNameBusy(true);
    setNameError(null);
    try {
      const result =
        nextName === libraryFolderName(info.path)
          ? await window.pond.query("library.identity.update", {
              name: nextName,
            })
          : await window.pond.query("library.rename", {
              name: nextName,
            });
      if (!result.ok) {
        setNameError(result.error ?? "Couldn't rename the library. Try again.");
        return;
      }
      setName(nextName);
      await refreshIdentity();
    } catch (error) {
      setNameError(errorCopy(error, "Couldn't rename the library. Try again."));
    } finally {
      setNameBusy(false);
    }
  };

  return (
    <>
      <Settings.Item id="setting-library-logo">
        <Settings.ItemDetails>
          <Settings.ItemTitle>Logo</Settings.ItemTitle>
          <Settings.ItemDescription>
            Recommended size is 256 × 256 px.
            <StatusNote error={logoError} />
          </Settings.ItemDescription>
        </Settings.ItemDetails>
        <Settings.ItemControl>
          {logo ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={logoBusy}
              onClick={() => void resetLogo()}
            >
              Reset
            </Button>
          ) : null}
          <Tooltip label={logo ? "Change Logo" : "Choose Logo"} side="bottom">
            <Button
              icon
              size="xl"
              variant="secondary"
              rounding="rounded"
              className={styles.logo}
              disabled={!info || logoBusy}
              aria-label={logo ? "Change Logo" : "Choose Logo"}
              onClick={() => void chooseLogo()}
            >
              <img src={logo ?? defaultAppIcon} alt="" />
            </Button>
          </Tooltip>
        </Settings.ItemControl>
      </Settings.Item>
      <Settings.Item id="setting-library-name">
        <Settings.ItemDetails>
          <Settings.ItemTitle>Name</Settings.ItemTitle>
          <StatusNote error={nameError} />
        </Settings.ItemDetails>
        <Settings.ItemControl>
          <Input.Root className={styles.name}>
            <Input.Field
              aria-label="Library Name"
              value={name}
              disabled={!info || nameBusy}
              onValueChange={(value) => {
                setName(value);
                setNameError(null);
              }}
              onBlur={() => void saveName()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape" && info) {
                  setName(info.name);
                  setNameError(null);
                }
              }}
            />
          </Input.Root>
        </Settings.ItemControl>
      </Settings.Item>
    </>
  );
}

function StatusNote({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <span className={styles.error} role="alert">
      {error}
    </span>
  );
}
