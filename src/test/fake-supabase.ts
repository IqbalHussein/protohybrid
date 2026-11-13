import type { SupabaseClient } from "@supabase/supabase-js";

// A stand-in for the supabase-js client in unit tests. Every query builder
// chain and rpc() call is recorded as a Call; `respond` decides what it
// resolves to. Only the builder methods this app uses are implemented.

export type Call = {
  table: string | null; // null for rpc
  rpc: string | null;
  op: "select" | "insert" | "update" | "upsert" | "delete" | "rpc";
  payload: unknown; // insert/update/upsert values, or rpc args
  options: unknown; // upsert options
  filters: [string, ...unknown[]][]; // e.g. ["eq", "id", "x"]
  returning: string | null; // .select() after a write
};

export type Result = { data?: unknown; error?: { message: string } | null };
export type Responder = (call: Call) => Result | undefined;

const FILTERS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "ilike", "like", "is", "order", "limit", "range"];

export function fakeSupabase(respond: Responder = () => undefined) {
  const calls: Call[] = [];

  const resolve = (call: Call) => {
    calls.push(call);
    const r = respond(call) ?? {};
    return { data: r.data ?? null, error: r.error ?? null };
  };

  function builder(table: string) {
    const call: Call = { table, rpc: null, op: "select", payload: undefined, options: undefined, filters: [], returning: null };
    let opSet = false;
    const b: Record<string, unknown> = {};
    const write = (op: Call["op"]) => (payload?: unknown, options?: unknown) => {
      call.op = op;
      call.payload = payload;
      call.options = options;
      opSet = true;
      return b;
    };
    b.insert = write("insert");
    b.update = write("update");
    b.upsert = write("upsert");
    b.delete = write("delete");
    b.select = (columns?: string) => {
      if (opSet) call.returning = columns ?? "*";
      else {
        call.op = "select";
        call.payload = columns ?? "*";
        opSet = true;
      }
      return b;
    };
    for (const f of FILTERS) {
      b[f] = (...args: unknown[]) => {
        call.filters.push([f, ...args]);
        return b;
      };
    }
    b.returns = () => b;
    b.single = () => Promise.resolve(resolve({ ...call, filters: [...call.filters, ["single"]] }));
    b.maybeSingle = () => Promise.resolve(resolve({ ...call, filters: [...call.filters, ["maybeSingle"]] }));
    b.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve(call)).then(onFulfilled, onRejected);
    return b;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: (name: string, args?: unknown) =>
      Promise.resolve(
        resolve({ table: null, rpc: name, op: "rpc", payload: args, options: undefined, filters: [], returning: null }),
      ),
  };

  return { client: client as unknown as SupabaseClient, calls };
}

// Finds the value passed to a filter, e.g. filterValue(call, "eq", "id").
export function filterValue(call: Call, kind: string, column: string): unknown {
  return call.filters.find((f) => f[0] === kind && f[1] === column)?.[2];
}

// next/navigation's redirect() throws; tests catch this to read the target.
export class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

export function formData(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v);
  }
  return fd;
}
