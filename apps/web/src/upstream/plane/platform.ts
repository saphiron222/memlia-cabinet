import { useEffect, useState } from "react";
/** Memlia platform port; no Plane store or identity. */
export function usePlatformOS() {
  const [isMobile, setMobile] = useState(
    () => matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const m = matchMedia("(max-width: 767px)");
    const update = () => setMobile(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return { isMobile };
}
