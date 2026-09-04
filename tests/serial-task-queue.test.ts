import { describe, expect, it, vi } from "vitest";

import { SerialTaskQueue } from "../src/audio/serial-task-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("SerialTaskQueue", () => {
  it("keeps a cancelled task's slot until its real work settles", async () => {
    const queue = new SerialTaskQueue();
    const firstWork = deferred<string>();
    const abort = new AbortController();
    const secondTask = vi.fn(async () => "second");

    const firstCaller = queue.run(() => firstWork.promise, abort.signal);
    abort.abort();
    await expect(firstCaller).rejects.toMatchObject({ name: "AbortError" });

    const secondCaller = queue.run(secondTask);
    await Promise.resolve();
    expect(secondTask).not.toHaveBeenCalled();

    firstWork.resolve("first");
    await expect(secondCaller).resolves.toBe("second");
    expect(secondTask).toHaveBeenCalledOnce();
  });

  it("continues after a real task failure", async () => {
    const queue = new SerialTaskQueue();
    await expect(queue.run(async () => {
      throw new Error("render failed");
    })).rejects.toThrow("render failed");
    await expect(queue.run(async () => "recovered")).resolves.toBe("recovered");
  });
});
