import { useEffect, useRef } from "react";
import { mountPlayer } from "../lib/player";
import type { Project } from "../lib/model";
import "../lib/player.css";
export function Player({
  project,
  media,
  index = 0,
  autoplay = true,
}: {
  project: Project;
  media: Record<string, string>;
  index?: number;
  autoplay?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current)
      return mountPlayer(root.current, project, media, { index, autoplay });
  }, [project, media, index, autoplay]);
  return <div ref={root} />;
}
