import { useState } from "react";
import { ImageOff } from "lucide-react";
import { tcgArtworkUrl } from "./catalog-display";

export default function CardArtwork({
  productId,
  localImage,
  name,
  compact = false,
}: {
  productId?: string | null;
  localImage?: string | null;
  name: string;
  compact?: boolean;
}) {
  const src = localImage || tcgArtworkUrl(productId);
  return (
    <ArtworkImage
      key={src || "missing"}
      src={src}
      name={name}
      compact={compact}
    />
  );
}

function ArtworkImage({
  src,
  name,
  compact,
}: {
  src: string | null;
  name: string;
  compact: boolean;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    src ? "loading" : "failed",
  );
  return (
    <span
      className={`card-artwork${compact ? " card-artwork-compact" : ""}`}
      data-status={status}
    >
      {src && status !== "failed" && (
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("failed")}
        />
      )}
      {status !== "ready" && (
        <span
          className="card-artwork-placeholder"
          role="status"
          aria-label={
            status === "loading"
              ? `Loading image for ${name}`
              : `Image unavailable for ${name}`
          }
        >
          <ImageOff size={compact ? 20 : 30} />
          {!compact && (
            <span>
              {status === "loading" ? "Loading artwork…" : "Image unavailable"}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
