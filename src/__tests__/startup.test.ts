import { EventEmitter } from "node:events";
import { jest } from "@jest/globals";
import {
  registerGracefulShutdown,
  SHUTDOWN_SIGNALS,
  type ServerHandle,
  type ShutdownSignalTarget,
} from "../startup.js";

class FakeSignalTarget extends EventEmitter implements ShutdownSignalTarget {
  exitCode: number | string | undefined;
}

describe("graceful shutdown", () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each(SHUTDOWN_SIGNALS)("closes the server after %s", async (signal) => {
    const handle: ServerHandle = { close: jest.fn(async () => {}) };
    const target = new FakeSignalTarget();
    const controller = registerGracefulShutdown(handle, target);

    target.emit(signal);
    await controller.shutdown(signal);

    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(target.exitCode).toBe(0);
    expect(target.listenerCount("SIGINT")).toBe(0);
    expect(target.listenerCount("SIGTERM")).toBe(0);
  });

  it("runs shutdown only once when multiple signals arrive", async () => {
    const handle: ServerHandle = { close: jest.fn(async () => {}) };
    const target = new FakeSignalTarget();
    const controller = registerGracefulShutdown(handle, target);

    await Promise.all([
      controller.shutdown("SIGTERM"),
      controller.shutdown("SIGINT"),
    ]);

    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("sets a failing exit code when shutdown fails", async () => {
    const handle: ServerHandle = {
      close: jest.fn(async () => {
        throw new Error("close failed");
      }),
    };
    const target = new FakeSignalTarget();
    const controller = registerGracefulShutdown(handle, target);

    await controller.shutdown("SIGTERM");

    expect(target.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[ERROR] Failed to shut down cleanly: close failed",
    );
  });
});
