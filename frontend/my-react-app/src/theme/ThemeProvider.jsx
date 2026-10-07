import { useState, useEffect, useMemo } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import { ThemeContext } from "./themeContext";

const STORAGE_KEY = "ui.theme";
const MODES = ["light", "dark", "system"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

function loadMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark() {
  return window.matchMedia?.(DARK_QUERY).matches ?? false;
}

// Shared Ant Design settings; colors match the CSS variables in index.css
function antdConfig(resolved) {
  const dark = resolved === "dark";
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: "#007A5A",
      colorLink: dark ? "#1D9BD1" : "#1164A3",
      borderRadius: 6,
      fontFamily: 'system-ui, "Segoe UI", Roboto, sans-serif',
      colorBgLayout: dark ? "#1A1D21" : "#F8F8F8",
      colorBgContainer: dark ? "#222529" : "#FFFFFF",
      colorBgElevated: dark ? "#2B2E33" : "#FFFFFF"
    },
    components: {
      Layout: { siderBg: "transparent", headerBg: dark ? "#222529" : "#FFFFFF" },
      Menu: {
        darkItemBg: "transparent",
        darkItemSelectedBg: "#1164A3",
        darkItemHoverBg: "rgba(255, 255, 255, 0.08)"
      }
    }
  };
}

function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(loadMode);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Follow the operating system's setting while mode is "system"
  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return undefined;
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved === "dark" ? "#19171D" : "#3F0E40");
  }, [resolved]);

  const value = useMemo(
    () => ({
      mode,
      resolved,
      setMode: (next) => {
        setModeState(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Storage unavailable; the choice lasts for this visit
        }
      }
    }),
    [mode, resolved]
  );

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider theme={antdConfig(resolved)}>{children}</ConfigProvider>
    </ThemeContext.Provider>
  );
}

export default ThemeProvider;
