#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const statusPath = join(homedir(), "Library", "Application Support", "Vencord", "YomitanExtension", "status.json");
const status = JSON.parse(await readFile(statusPath, "utf8"));
const views = Array.isArray(status.contentScripts) ? status.contentScripts : [];

if (views.length === 0) {
    throw new Error("No live Discord document is being monitored for the Yomitan content script");
}

const failed = views.filter(({ state }) => state !== "ready");
if (failed.length > 0) {
    throw new Error(`Yomitan scanner is not ready in Discord: ${JSON.stringify(failed)}`);
}

console.log(`Yomitan scanner ready in ${views.length} Discord document(s)`);
