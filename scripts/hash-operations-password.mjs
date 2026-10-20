import { pbkdf2Sync, randomBytes } from "node:crypto";

const ITERATIONS = 210_000;
const MIN_PASSWORD_LENGTH = 12;

const password = await readPassword();
if (password.length < MIN_PASSWORD_LENGTH) {
  process.stderr.write(`密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。\n`);
  process.exitCode = 1;
} else {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  process.stdout.write(
    `pbkdf2$${ITERATIONS}$${salt.toString("base64url")}$${digest.toString("base64url")}\n`,
  );
}

async function readPassword() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    let value = "";
    for await (const chunk of process.stdin) value += chunk;
    return value.replace(/[\r\n]+$/, "");
  }

  process.stderr.write("请输入运营平台管理员密码：");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stderr.write("\n");
    };
    const onData = (key) => {
      if (key === "\u0003") {
        cleanup();
        reject(new Error("已取消"));
        return;
      }
      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(value);
        return;
      }
      if (key === "\u0008" || key === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      if (key >= " ") value += key;
    };
    process.stdin.on("data", onData);
  });
}
