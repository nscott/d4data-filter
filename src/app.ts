import D4DataFilter from "./d4DataFilter.js";

// Pretty Simple.
// Enumerate the files we can do something with
// Rip through all files, string replace with the filters N times
// Re-write them.
// Take another pass once we've thrown away the stuff we don't want at all
// Smash together stuff that makes it easier to understand
// Add context
// :tada:

const PREFIX: string = process.env.DF_PREFIX || "df"
const D4DATA_DIR: string = process.env.D4DATA_DIR || "../d4data"
const DEBUG_MODE: boolean = (process.env.DEBUG === "1") || false

const d4DataFilter = new D4DataFilter(PREFIX, D4DATA_DIR, DEBUG_MODE);

try {
  await d4DataFilter.process();
} catch(e: any) {
  console.log(e);
}