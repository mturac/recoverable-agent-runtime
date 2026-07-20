export class StaleWorkerError extends Error {
  readonly code = "STALE_WORKER" as const;
  constructor(
    message: string,
    readonly presentedToken: bigint,
    readonly currentToken: bigint,
  ) {
    super(message);
    this.name = "StaleWorkerError";
  }
}

export class OccConflictError extends Error {
  readonly code = "OCC_CONFLICT" as const;
  constructor(message: string) {
    super(message);
    this.name = "OccConflictError";
  }
}

export class ReceiptRequiredError extends Error {
  readonly code = "RECEIPT_REQUIRED" as const;
  constructor(message: string) {
    super(message);
    this.name = "ReceiptRequiredError";
  }
}

export class LeaseError extends Error {
  readonly code = "LEASE_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "LeaseError";
  }
}
