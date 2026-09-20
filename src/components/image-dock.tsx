"use client";

import { originLabel, type GalleryItem, type GalleryState } from "@/lib/visual/gallery";
import { safetyLabel } from "@/lib/visual/safety";

function labelForStatus(item: GalleryItem): string {
  if (item.safetyStatus) return safetyLabel(item.safetyStatus);
  if (item.nsfw) return "Owner-private";
  if (item.kind === "ad") return "Brand-safe";
  return safetyLabel("brand_safe");
}

export function ImageDock({
  gallery,
  compact,
  onToggle,
  onSelect,
  onUseHome,
  onDelete,
}: {
  gallery: GalleryState;
  compact?: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onUseHome: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const generated = gallery.items.filter((i) => i.source === "generated");
  const current = generated.find((i) => i.id === gallery.currentId) || generated[0];
  const status = gallery.status === "creating"
    ? "Creating image…"
    : gallery.status === "failed"
      ? (gallery.error || "Generation failed")
      : gallery.status === "ready"
        ? "Image ready"
        : "";
  const open = Boolean(gallery.libraryOpen);

  return (
    <div className={`la-images ${compact ? "is-compact" : ""}`} data-image-dock="1" data-open={open ? "1" : "0"}>
      <div className="la-images-bar">
        <button type="button" className="la-btn la-btn-quiet" onClick={onToggle}>
          Images{generated.length ? ` · ${generated.length}` : ""}
        </button>
        {status ? (
          <span className={`la-images-status ${gallery.status === "failed" ? "is-bad" : gallery.status === "creating" ? "is-live" : ""}`} data-image-status={gallery.status || "idle"}>
            {status}
          </span>
        ) : null}
      </div>
      {open ? (
        <div className="la-images-panel" data-image-library="1">
          {!generated.length ? (
            <p className="text-sm text-muted">No AI-generated images yet. Presets live in Settings. Ask Ara to generate something new.</p>
          ) : (
            <ul className="la-images-list">
              {generated.map((item) => (
                <li key={item.id} className={item.id === current?.id ? "is-current" : ""}>
                  <button type="button" className="la-images-thumb" onClick={() => onSelect(item.id)}>
                    <img src={item.url} alt="" />
                  </button>
                  <div className="min-w-0">
                    <p className="la-images-name">{item.label}</p>
                    <p className="text-xs text-muted">{originLabel(item)} · {labelForStatus(item)}</p>
                  </div>
                  <div className="la-images-actions">
                    <button type="button" className="la-btn la-btn-quiet" onClick={() => onUseHome(item.id)}>Use as Home</button>
                    <button type="button" className="la-btn la-btn-quiet" onClick={() => onDelete(item.id)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : current && !compact ? (
        <div className="la-images-latest" data-latest-generated="1">
          <img src={current.url} alt="" />
          <p className="text-xs text-muted">{originLabel(current)} · {current.label}</p>
        </div>
      ) : null}
    </div>
  );
}
