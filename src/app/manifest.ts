import type { MetadataRoute } from "next";

/** Installed to the iPad home screen this runs fullscreen with no browser
 *  chrome for a paw to hit. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cat Games",
    short_name: "Cat Games",
    description: "Hunting games for cats, built for the iPad.",
    start_url: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#07090d",
    theme_color: "#07090d",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },

    ],
  };
}
