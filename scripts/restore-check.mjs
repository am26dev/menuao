import { restoreSnapshot } from "./backup.mjs";
const [snapshot, destination] = process.argv.slice(2);
if (!snapshot || !destination) {
  console.error(
    "Usage: node scripts/restore-check.mjs SNAPSHOT NEW_ISOLATED_DIRECTORY",
  );
  process.exitCode = 1;
} else {
  try {
    console.log(
      JSON.stringify(restoreSnapshot(snapshot, destination), null, 2),
    );
  } catch (error) {
    console.error("Restore verification failed:", error.message);
    process.exitCode = 1;
  }
}
