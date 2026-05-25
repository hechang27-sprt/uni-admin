import { DocumentServiceError } from "./errors";
import type { JsonObject, JsonValue } from "./types";

export type JsonPatchOperation =
  | { op: "add"; path: string; value: JsonValue }
  | { op: "replace"; path: string; value: JsonValue }
  | { op: "remove"; path: string }
  | { op: "test"; path: string; value: JsonValue }
  | { op: string; path?: string; value?: JsonValue };

type ParentTarget =
  | { kind: "array"; parent: JsonValue[]; key: string }
  | { kind: "object"; parent: JsonObject; key: string };

type ExistingTarget =
  | { kind: "array"; parent: JsonValue[]; key: number }
  | { kind: "object"; parent: JsonObject; key: string };

export function applyJsonPatch(
  document: JsonObject,
  operations: JsonPatchOperation[],
): JsonObject {
  let result: JsonValue = cloneJson(document);

  for (const operation of operations) {
    validatePatchOperation(operation);

    switch (operation.op) {
      case "add": {
        result = addValue(
          result,
          operation.path,
          cloneJson(getPatchValue(operation)),
        );
        break;
      }
      case "replace": {
        result = replaceValue(
          result,
          operation.path,
          cloneJson(getPatchValue(operation)),
        );
        break;
      }
      case "remove": {
        result = removeValue(result, operation.path);
        break;
      }
      case "test": {
        testValue(result, operation.path, getPatchValue(operation));
        break;
      }
    }
  }

  if (!isJsonObject(result)) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      "Patched document must remain a JSON object",
    );
  }

  return result;
}

function validatePatchOperation(
  operation: JsonPatchOperation,
): asserts operation is JsonPatchOperation & {
  path: string;
} {
  if (
    operation.op !== "add" &&
    operation.op !== "replace" &&
    operation.op !== "remove" &&
    operation.op !== "test"
  ) {
    throw new DocumentServiceError(
      "UNSUPPORTED_OPERATION",
      `Unsupported JSON Patch operation: ${operation.op}`,
      {
        operation: operation.op,
      },
    );
  }

  if (typeof operation.path !== "string") {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      "JSON Patch operation path must be a string",
      {
        operation: operation.op,
      },
    );
  }

  if (
    (operation.op === "add" ||
      operation.op === "replace" ||
      operation.op === "test") &&
    !("value" in operation)
  ) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `JSON Patch ${operation.op} operation requires a value`,
      {
        operation: operation.op,
        path: operation.path,
      },
    );
  }
}

function getPatchValue(operation: JsonPatchOperation): JsonValue {
  if (!("value" in operation) || operation.value === undefined) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `JSON Patch ${operation.op} operation requires a value`,
      {
        operation: operation.op,
        path: operation.path,
      },
    );
  }

  return operation.value;
}

function addValue(
  root: JsonValue,
  pointer: string,
  value: JsonValue,
): JsonValue {
  if (pointer === "") {
    return value;
  }

  const target = resolveParent(root, pointer);

  if (target.kind === "array") {
    const index = parseArrayIndex(target.parent, target.key, true, pointer);
    target.parent.splice(index, 0, value);
    return root;
  }

  target.parent[target.key] = value;
  return root;
}

function replaceValue(
  root: JsonValue,
  pointer: string,
  value: JsonValue,
): JsonValue {
  if (pointer === "") {
    return value;
  }

  const target = resolveExistingTarget(root, pointer);

  switch (target.kind) {
    case "array": {
      target.parent[target.key] = value;
      break;
    }
    case "object": {
      target.parent[target.key] = value;
      break;
    }
  }

  return root;
}

function removeValue(root: JsonValue, pointer: string): JsonValue {
  if (pointer === "") {
    return null;
  }

  const target = resolveExistingTarget(root, pointer);

  if (target.kind === "array") {
    target.parent.splice(target.key, 1);
    return root;
  }

  Reflect.deleteProperty(target.parent, target.key);
  return root;
}

function testValue(
  root: JsonValue,
  pointer: string,
  expected: JsonValue,
): void {
  const actual = pointer === "" ? root : getExistingValue(root, pointer);

  if (!jsonEqual(actual, expected)) {
    throw new DocumentServiceError(
      "CONFLICT_PATCH_TEST_FAILED",
      "JSON Patch test operation failed",
      {
        path: pointer,
      },
    );
  }
}

function getExistingValue(root: JsonValue, pointer: string): JsonValue {
  const target = resolveExistingTarget(root, pointer);
  const value =
    target.kind === "array"
      ? target.parent[target.key]
      : target.parent[target.key];

  if (value === undefined) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `JSON Pointer path does not exist: ${pointer}`,
      {
        path: pointer,
      },
    );
  }

  return value;
}

function resolveExistingTarget(
  root: JsonValue,
  pointer: string,
): ExistingTarget {
  const target = resolveParent(root, pointer);

  if (target.kind === "array") {
    const index = parseArrayIndex(target.parent, target.key, false, pointer);
    return { kind: "array", parent: target.parent, key: index };
  }

  if (!Object.hasOwn(target.parent, target.key)) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `JSON Pointer path does not exist: ${pointer}`,
      {
        path: pointer,
      },
    );
  }

  return target;
}

function resolveParent(root: JsonValue, pointer: string): ParentTarget {
  const segments = parsePointer(pointer);

  if (segments.length === 0) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      "JSON Pointer cannot resolve a parent for the document root",
      {
        path: pointer,
      },
    );
  }

  let current: JsonValue = root;

  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      const value = current[parseArrayIndex(current, segment, false, pointer)];

      if (value === undefined) {
        throw new DocumentServiceError(
          "VALIDATION_FAILED",
          `JSON Pointer path does not exist: ${pointer}`,
          {
            path: pointer,
          },
        );
      }

      current = value;
      continue;
    }

    if (isJsonObject(current) && Object.hasOwn(current, segment)) {
      const value = current[segment];

      if (value === undefined) {
        throw new DocumentServiceError(
          "VALIDATION_FAILED",
          `JSON Pointer path does not exist: ${pointer}`,
          {
            path: pointer,
          },
        );
      }

      current = value;
      continue;
    }

    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `JSON Pointer path does not exist: ${pointer}`,
      {
        path: pointer,
      },
    );
  }

  if (Array.isArray(current)) {
    return { kind: "array", parent: current, key: segments.at(-1)! };
  }

  if (!isJsonObject(current)) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `JSON Pointer parent is not a container: ${pointer}`,
      {
        path: pointer,
      },
    );
  }

  return { kind: "object", parent: current, key: segments.at(-1)! };
}

function parsePointer(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }

  if (!pointer.startsWith("/")) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `Invalid JSON Pointer path: ${pointer}`,
      {
        path: pointer,
      },
    );
  }

  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function parseArrayIndex(
  array: JsonValue[],
  key: string | number,
  allowAppend: boolean,
  pointer: string,
): number {
  if (key === "-" && allowAppend) {
    return array.length;
  }

  const index = typeof key === "number" ? key : Number(key);

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > array.length ||
    (!allowAppend && index === array.length)
  ) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `Invalid JSON Pointer array index: ${pointer}`,
      {
        path: pointer,
      },
    );
  }

  return index;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<TValue extends JsonValue>(value: TValue): TValue {
  return structuredClone(value);
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => {
        const rightValue = right[index];
        return rightValue !== undefined && jsonEqual(value, rightValue);
      })
    );
  }

  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => {
        const leftValue = left[key];
        const rightValue = right[key];
        return (
          leftValue !== undefined &&
          rightValue !== undefined &&
          Object.hasOwn(right, key) &&
          jsonEqual(leftValue, rightValue)
        );
      })
    );
  }

  return false;
}
