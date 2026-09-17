import { useEffect, useState, useSyncExternalStore } from "react";
import { GameController } from "../game/controller.ts";
import { decide } from "../jev/client.ts";

export function useGame() {
  const [controller] = useState(() => new GameController({ decide }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  // Pause when the component goes away (also covers StrictMode's double mount and HMR).
  useEffect(() => () => controller.pause(), [controller]);

  return { controller, snapshot };
}
