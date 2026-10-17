// Minimal stand-in for the Workers runtime base class so the Durable Object can be unit-tested in Node.
export class DurableObject<E = unknown> {
  constructor(
    protected ctx: unknown,
    protected env: E,
  ) {}
}
