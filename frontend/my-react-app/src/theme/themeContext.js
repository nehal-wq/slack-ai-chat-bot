import { createContext, useContext } from "react";

// mode: what the person chose ("light" | "dark" | "system")
// resolved: what is actually shown ("light" | "dark")
export const ThemeContext = createContext({
  mode: "system",
  resolved: "light",
  setMode: () => {}
});

export function useTheme() {
  return useContext(ThemeContext);
}
