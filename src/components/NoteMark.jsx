import React from "react";

/**
 * NoteMark — uPod's logo / cover-art placeholder mark.
 * A pair of beamed eighth notes matching the user's reference image:
 * left notehead lower with a shorter stem, right notehead higher with a
 * taller stem, connected by a beam that runs near the BOTTOM of the
 * stems (not the top) — deliberately not a treble/bass clef.
 *
 * Renders in `currentColor` so it can sit on any theme or accent color
 * just by setting `color` on a parent/wrapper — no hardcoded fills.
 *
 * Usage:
 *   <NoteMark size={48} />                      // default, currentColor
 *   <NoteMark size={200} style={{ color: album.accent }} />
 *   <NoteMark size={96} className="cover-placeholder-mark" />
 */
export default function NoteMark({ size = 48, className = "", style = {}, title }) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size * 1.08}
      viewBox="0 0 480 520"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <g fill="currentColor">
        {/* Left notehead — lower, larger */}
        <ellipse cx="105" cy="90" rx="98" ry="60" transform="rotate(-18 105 90)" />
        {/* Right notehead — higher, slightly smaller */}
        <ellipse cx="378" cy="64" rx="92" ry="58" transform="rotate(-18 378 64)" />
        {/* Left stem — shorter, starts lower */}
        <polygon points="40,98 80,82 80,458 40,472" />
        {/* Right stem — taller, starts higher */}
        <polygon points="306,70 346,54 346,432 306,446" />
        {/* Beam connecting the two stems near the bottom */}
        <polygon points="40,472 346,432 346,396 40,436" />
      </g>
    </svg>
  );
}
