/**
 * Guimard's Ironwork direction contract (see apps/web/.impeccable/surfaces/route.md).
 * Dark is the primary, tested identity (night city, lamp-glow) — light translates the
 * same materials (verdigris, bronze, ironwork) to a daytime register (pale Paris
 * limestone, not a generic white) rather than inventing a second identity.
 */
export interface ThemePalette {
  ground: string;
  verdigris: string;
  bronze: string;
  amberLamp: string;
  disruption: string;
  ink: string;
}

export const themes: { dark: ThemePalette; light: ThemePalette } = {
  dark: {
    ground: "#1c1a16", // near-black city ground
    verdigris: "#4a6b57", // quiet, at-rest line color
    bronze: "#a9823f",
    amberLamp: "#e0a339", // live/confirmed glow
    disruption: "#c23b2d", // the one earned accent — live disruptions only
    ink: "#cfc9ba", // muted warm-light text on dark ground
  },
  light: {
    ground: "#e8e2d4", // pale Paris limestone, not generic white
    verdigris: "#3d5645", // deepened for contrast on a light ground
    bronze: "#7a5c2e",
    amberLamp: "#b8791f",
    disruption: "#a83226",
    ink: "#2a2620", // warm charcoal text on light ground
  },
};
