import { Socket } from "node:net";
import { Client } from "pg";

// Pool.connect cannot cancel a pending checkout/startup through its public API.
// Each diagnostic control instead owns one Client and its supplied transport
// from creation to close. No shared Pool, borrower or pending queue is touched.
export function createDiagnosticControl(config = {}) {
  if (config.connection)
    throw new Error("Diagnostic control cannot borrow an existing connection");
  let active = null,
    ended = false;
  return {
    queryWithin(input, deadline = performance.now() + 5000) {
      if (ended)
        return Promise.reject(new Error("Diagnostic control is closed"));
      if (active)
        return Promise.reject(
          new Error("Diagnostic control is already in use"),
        );
      if (!Number.isFinite(deadline))
        return Promise.reject(new Error("Invalid diagnostic control deadline"));
      const expires = Math.min(deadline, performance.now() + 5000);
      const remaining = () => Math.floor(expires - performance.now());
      const timeoutError = () =>
        new Error("Diagnostic control exceeded its deadline");
      const budget = remaining();
      if (budget <= 0) return Promise.reject(timeoutError());

      const transport = new Socket();
      const operation = {};
      active = operation;
      operation.done = new Promise((resolve, reject) => {
        let client,
          failure,
          result,
          queried = false,
          aborting = false;
        const abort = (error) => {
          failure ??= error;
          aborting = true;
          // end() marks the Client as ending; destroy() also closes a startup
          // or half-open graceful close whose peer may never respond.
          try {
            client?.end(() => {});
          } catch (closeError) {
            failure ??= closeError;
          } finally {
            transport.destroy();
          }
        };
        operation.abort = () => abort(new Error("Diagnostic control closed"));
        const timer = setTimeout(() => abort(timeoutError()), budget);
        transport.once("close", () => {
          clearTimeout(timer);
          if (active === operation) active = null;
          if (!failure && performance.now() >= expires)
            failure = timeoutError();
          if (failure) reject(failure);
          else if (!queried)
            reject(new Error("Diagnostic control transport closed early"));
          else resolve(result);
        });
        try {
          client = new Client({
            ...config,
            // pg 8.23.1 accepts a stream factory. Keep our own Socket reference
            // so cancellation never reaches into pg/pg-pool private state.
            stream: () => transport,
            connectionTimeoutMillis: budget,
            query_timeout: budget,
            statement_timeout: Math.min(5000, config.statement_timeout ?? 5000),
            pipeline: false,
          });
          client.on("error", abort);
          client.connect((error) => {
            if (error) return abort(error);
            if (aborting || transport.destroyed) {
              client.end(() => {});
              transport.destroy();
              return;
            }
            // Connection startup consumes this operation's original 5s (or
            // smaller stage remainder), not a second query allowance.
            const queryBudget = remaining();
            if (queryBudget <= 0) return abort(timeoutError());
            try {
              client.query(
                {
                  ...(typeof input === "string" ? { text: input } : input),
                  query_timeout: queryBudget,
                },
                (error, response) => {
                  if (aborting || transport.destroyed) return;
                  if (error) return abort(error);
                  if (remaining() <= 0) return abort(timeoutError());
                  queried = true;
                  result = response;
                  // Keep the same timer until transport close is acknowledged.
                  client.end(() => {});
                },
              );
            } catch (error) {
              abort(error);
            }
          });
        } catch (error) {
          abort(error);
        }
      });
      return operation.done;
    },
    async end() {
      ended = true;
      const operation = active;
      if (operation) {
        operation.abort();
        await operation.done.catch(() => {});
      }
    },
  };
}
