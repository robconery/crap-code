/**
 * Base class for all domain errors in this codebase.
 *
 * All custom errors extend DomainError so that catch blocks can distinguish
 * expected business failures from unexpected runtime errors with a single
 * instanceof check. The `cause` option threads the original error through
 * the chain without losing the stack trace.
 */
export class DomainError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // Restore the prototype chain — required when extending built-in classes
    // in TypeScript targeting ES5/ES6 with class transforms.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}
