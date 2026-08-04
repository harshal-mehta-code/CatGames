import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/** Generated at build time — keeps the repo free of binary assets. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#07090d",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Legs */}
        {[-1, 0, 1].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              width: 300,
              height: 14,
              borderRadius: 8,
              background: "#7a5a1c",
              transform: `rotate(${i * 34}deg)`,
            }}
          />
        ))}
        {/* Body */}
        <div
          style={{
            position: "absolute",
            width: 250,
            height: 300,
            borderRadius: "50%",
            background: "linear-gradient(160deg, #ffe6a3 0%, #ffd479 45%, #b8862c 100%)",
          }}
        />
        {/* Elytra seam */}
        <div
          style={{
            position: "absolute",
            width: 8,
            height: 250,
            borderRadius: 4,
            background: "rgba(0,0,0,0.45)",
          }}
        />
        {/* Head */}
        <div
          style={{
            position: "absolute",
            top: 108,
            width: 108,
            height: 92,
            borderRadius: "50%",
            background: "#3a2a0c",
          }}
        />
      </div>
    ),
    size,
  );
}
