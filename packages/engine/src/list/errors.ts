/** Thrown when `list --pack` names a Pack absent from the active manifest. */
export class UnknownPackError extends Error {
  constructor(packName: string) {
    super(`No installed Pack exists with name "${packName}".`);
    this.name = "UnknownPackError";
  }
}

/** Thrown when an injected Store does not provide the rich metadata capability. */
export class PackDetailsUnavailableError extends Error {
  constructor() {
    super("The selected Store does not provide Pack metadata.");
    this.name = "PackDetailsUnavailableError";
  }
}
