// Frees the dev server port before `next dev` starts, so stale/orphaned
// instances from previous runs never block a fresh start.
const { execSync } = require("child_process");

const port = process.argv[2] || "3000";

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return "";
  }
}

if (process.platform === "win32") {
  const out = run(`netstat -ano -p tcp | findstr :${port}`);
  const pids = new Set(
    out
      .split("\n")
      .map((line) => line.trim().split(/\s+/).pop())
      .filter((pid) => pid && pid !== "0")
  );
  for (const pid of pids) {
    run(`taskkill /F /PID ${pid}`);
    console.log(`Freed port ${port} (killed PID ${pid})`);
  }
} else {
  const out = run(`lsof -ti tcp:${port}`);
  const pids = out.split("\n").filter(Boolean);
  for (const pid of pids) {
    run(`kill -9 ${pid}`);
    console.log(`Freed port ${port} (killed PID ${pid})`);
  }
}
