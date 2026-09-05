import MetroMap from "@/components/MetroMap";

const Home = () => {
  return (
    // 100dvh, not 100vh: iOS Safari calculates 100vh against the largest possible
    // viewport (as if its toolbar were fully collapsed), not what's actually visible on
    // load — anything pinned near the bottom edge (the disruption badge) can end up
    // hidden behind Safari's own chrome. 100dvh tracks the real, currently-visible area.
    <main style={{ width: "100vw", height: "100dvh" }}>
      <MetroMap />
    </main>
  );
};

export default Home;
