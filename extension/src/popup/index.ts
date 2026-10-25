import { chromeStorage } from "../core/chrome-storage";
import { CounterStore } from "../core/counters";
import { SettingsStore } from "../core/settings";
import { mountPopup } from "./popup";

const root = document.getElementById("root");
if (root) mountPopup(root, new SettingsStore(chromeStorage), new CounterStore(chromeStorage, { flushDelayMs: 0 }));
