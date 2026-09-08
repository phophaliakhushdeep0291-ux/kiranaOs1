import { AppError } from "../../../shared/errors/index.js";

/** The whole turn shares a deadline, including a final answer and SDK retries. */
export async function providerCompletion(selected, body, deadline) {
  const remaining = deadline - Date.now();
  const timeoutError = () => new AppError("The assistant took too long to respond. Please try again.", 504, "AI_TURN_TIMEOUT");
  if (remaining <= 0) throw timeoutError();
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      selected.client.chat.completions.create(body, { signal: controller.signal, timeout: remaining, maxRetries: 0 }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => { reject(timeoutError()); controller.abort(); }, remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
