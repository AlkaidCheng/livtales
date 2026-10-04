export class ObjectConflictError extends Error {
  constructor() {
    super("The object changed after the supplied version was read.");
    this.name = "ObjectConflictError";
  }
}

/**
 * An undo or redo refused because an object its command changed has
 * changed since. The refusal has already taken the command, and every other
 * one that changed that object, off the caller's stack; `objectId` names the
 * object.
 */
export class CommandStepRefusedError extends ObjectConflictError {
  readonly objectId: string;

  constructor(objectId: string) {
    super();
    this.name = "CommandStepRefusedError";
    this.objectId = objectId;
  }
}

export class CommandConflictError extends Error {
  constructor() {
    super("The command ID was already used with different input.");
    this.name = "CommandConflictError";
  }
}

export class LabelNameConflictError extends Error {
  constructor() {
    super("A label with this name already exists.");
    this.name = "LabelNameConflictError";
  }
}

export class InvalidObjectStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidObjectStateError";
  }
}

export class InvalidRelationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRelationError";
  }
}

export class RelationConflictError extends Error {
  constructor() {
    super("The active relationship already exists.");
    this.name = "RelationConflictError";
  }
}

export class InvalidDocumentUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentUploadError";
  }
}

export class DocumentTransferUnavailableError extends Error {
  constructor() {
    super("The document transfer is unavailable.");
    this.name = "DocumentTransferUnavailableError";
  }
}
export class CommandStackConflictError extends Error {
  constructor() {
    super("The command history changed. Refresh before trying again.");
    this.name = "CommandStackConflictError";
  }
}
